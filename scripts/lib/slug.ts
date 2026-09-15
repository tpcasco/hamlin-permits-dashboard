export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Stable id derived from the slug; new projects get a short random suffix to survive renames. */
export function makeId(slug: string, salt = ''): string {
  return salt ? `${slug}-${salt}` : slug;
}
