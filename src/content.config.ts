import { defineCollection } from 'astro:content';
import { file } from 'astro/loaders';
import { ProjectSchema, ChangelogEntrySchema } from './schemas/project';

export const collections = {
  projects: defineCollection({ loader: file('./data/projects.json'), schema: ProjectSchema }),
  changelog: defineCollection({ loader: file('./data/changelog.json'), schema: ChangelogEntrySchema }),
};
