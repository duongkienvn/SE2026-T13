/** MOB-08 retires the foundation-only bypass. All app builds require real auth. */
export function isPublicNavigationPreview(_path: string): boolean {
  void _path;
  return false;
}
