import { defineField, defineType } from 'sanity';

export const homepage = defineType({
  name: 'homepage',
  title: 'Homepage',
  type: 'document',
  fields: [
    defineField({
      name: 'heroTitle',
      title: 'Nadpis v hlavičce',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'heroSubtitle',
      title: 'Podnadpis v hlavičce',
      type: 'text',
      rows: 2,
    }),
    defineField({
      name: 'intro',
      title: 'Úvodní text',
      type: 'blockContent',
    }),
    defineField({
      name: 'galleryIntro',
      title: 'Text fotogalerie',
      type: 'blockContent',
    }),
    defineField({
      name: 'featuredAlbum',
      title: 'Vybrané album na homepage',
      type: 'reference',
      to: [{ type: 'album' }],
    }),
  ],
});
