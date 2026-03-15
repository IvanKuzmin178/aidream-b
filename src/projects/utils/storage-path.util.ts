/**
 * GCS storage path helpers.
 * New projects: users/{userId}/{slug}/{projectId}/
 * Legacy projects (no storagePrefix): projects/{projectId}/
 */
export function slugify(title: string): string {
  const s = (title || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s.slice(0, 50) || 'project';
}

export function buildStoragePrefix(
  userId: string,
  projectId: string,
  title: string,
): string {
  const slug = slugify(title || 'untitled');
  return `users/${userId}/${slug}/${projectId}`;
}

/**
 * Returns GCS storage prefix for a project.
 * New projects have storagePrefix (users/uid/slug/id).
 * Legacy projects use projects/id.
 */
export function getStoragePrefix(
  project: { id: string; storagePrefix?: string },
): string {
  return project.storagePrefix ?? `projects/${project.id}`;
}
