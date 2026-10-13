import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * After a failed submit, moves keyboard focus to the first field marked
 * `aria-invalid="true"`, so users don't have to hunt for the error.
 * Call `focusFirstInvalid()` right after setting the field errors.
 */
export function useFocusFirstInvalid<
  T extends HTMLElement = HTMLFormElement,
>() {
  const formRef = useRef<T>(null);
  const [request, setRequest] = useState(0);

  useEffect(() => {
    if (request === 0) return;
    formRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?.focus();
  }, [request]);

  const focusFirstInvalid = useCallback(
    () => setRequest((count) => count + 1),
    [],
  );

  return { formRef, focusFirstInvalid };
}
