import { defineField, defineType } from 'sanity';
import { DriveFolderInput } from '../components/DriveFolderInput';

export const album = defineType({
  name: 'album',
  title: 'Album',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Název alba',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'title', maxLength: 96 },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'date',
      title: 'Datum akce',
      type: 'date',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'schoolYear',
      title: 'Školní rok',
      type: 'string',
      description: 'Např. 2024/2025',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'driveFolderId',
      title: 'Google Drive složka',
      type: 'string',
      description: 'Vlož ID nebo URL složky s fotkami.',
      components: {
        input: DriveFolderInput,
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'published',
      title: 'Publikovat album',
      type: 'boolean',
      initialValue: false,
    }),
    defineField({
      name: 'coverImage',
      title: 'Cover (volitelné)',
      type: 'image',
      options: { hotspot: true },
      fields: [
        {
          name: 'alt',
          title: 'Alternativní text',
          type: 'string',
        },
      ],
    }),
  ],
  preview: {
    select: {
      title: 'title',
      subtitle: 'schoolYear',
      media: 'coverImage',
    },
  },
});
