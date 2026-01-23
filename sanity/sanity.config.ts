import { defineConfig } from 'sanity';
import { deskTool } from 'sanity/desk';
import { visionTool } from '@sanity/vision';
import { schemaTypes } from './schemaTypes';

const projectId = process.env.SANITY_PROJECT_ID ?? process.env.SANITY_STUDIO_PROJECT_ID ?? '';
const dataset = process.env.SANITY_DATASET ?? process.env.SANITY_STUDIO_DATASET ?? '';

if (!projectId || !dataset) {
  console.warn(
    '[sanity] Missing SANITY_PROJECT_ID or SANITY_DATASET. Create .env with these values before running the studio.',
  );
}

export default defineConfig({
  name: 'default',
  title: 'SPTO Zelená liga',
  projectId,
  dataset,
  plugins: [deskTool(), visionTool()],
  schema: {
    types: schemaTypes,
  },
});
