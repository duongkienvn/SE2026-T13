"""Preserve protected dotenv bytes except the three release coordinates."""

import os
from pathlib import Path
import re
import stat
import tempfile


IMAGES = {
    "BACKEND_IMAGE": "ghcr.io/duongkienvn/kanvexa-backend",
    "FRONTEND_IMAGE": "ghcr.io/duongkienvn/kanvexa-frontend",
}


def release_values(sha):
    if not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise ValueError("Expected a full lowercase commit SHA")
    return {"IMAGE_TAG": sha, **IMAGES}


def render_release(original, sha):
    values = release_values(sha)
    seen = set()
    result = []
    for line in original.splitlines(keepends=True):
        if not line.strip() or line.lstrip().startswith(b"#"):
            result.append(line)
            continue
        match = re.match(rb"[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z_0-9]*)[ \t]*=[ \t]*(.*)", line.rstrip(b"\r\n"))
        if not match:
            raise ValueError("Unsupported dotenv syntax; operator review required")
        value = match[2]
        # Fail closed on multiline values rather than mistake their contents for keys.
        if value[:1] in (b"'", b'"') and not re.fullmatch(
            rb"'(?:[^'\\]|\\.)*'[ \t]*(?:#.*)?|\"(?:[^\"\\]|\\.)*\"[ \t]*(?:#.*)?", value
        ):
            raise ValueError("Multiline or ambiguous dotenv value; operator review required")
        key = match[1].decode("ascii")
        if key in values:
            if key in seen:
                raise ValueError("Duplicate release key; operator review required")
            seen.add(key)
            ending = b"\r\n" if line.endswith(b"\r\n") else b"\n"
            result.append(f"{key}={values[key]}".encode() + ending)
        else:
            result.append(line)
    output = b"".join(result)
    for key in values.keys() - seen:
        if output and not output.endswith(b"\n"):
            output += b"\n"
        output += f"{key}={values[key]}\n".encode()
    return output


def require_protected_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ValueError("Env must be a regular, unlinked file")
    if os.name == "posix":
        parent = path.parent.stat()
        if (info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o600
                or parent.st_uid != os.geteuid() or parent.st_mode & 0o022):
            raise ValueError("Env must be owner-only 0600 in a protected owned directory")


def update_release(path, sha):
    path = Path(path)
    require_protected_file(path)
    original = path.read_bytes()
    updated = render_release(original, sha)
    # Exclusive files in the same protected directory; rename cannot cross filesystems.
    backup_fd, backup = tempfile.mkstemp(prefix=f"{path.name}.backup-{sha}.", dir=path.parent)
    with os.fdopen(backup_fd, "wb") as stream:
        os.chmod(backup, 0o600)
        stream.write(original)
        stream.flush()
        os.fsync(stream.fileno())
    temporary = None
    try:
        fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        with os.fdopen(fd, "wb") as stream:
            os.chmod(temporary, 0o600)
            stream.write(updated)
            stream.flush()
            os.fsync(stream.fileno())
        require_protected_file(path)
        if path.read_bytes() != original:
            raise ValueError("Env changed concurrently; refusing replacement")
        os.replace(temporary, path)
        temporary = None
        if os.name == "posix":
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if temporary:
            os.unlink(temporary)
    return Path(backup)
