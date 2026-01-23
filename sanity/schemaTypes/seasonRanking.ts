import { defineField, defineType } from 'sanity';

export const seasonRanking = defineType({
  name: 'seasonRanking',
  title: 'Pořadí sezóny',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Název',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'seasonLabel',
      title: 'Sezóna',
      type: 'string',
      description: 'Např. 2024/2025',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'published',
      title: 'Publikovat',
      type: 'boolean',
      initialValue: false,
    }),
    defineField({
      name: 'entries',
      title: 'Pořadí',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'position', title: 'Pozice', type: 'number' },
            { name: 'name', title: 'Oddíl', type: 'string' },
            { name: 'points', title: 'Body', type: 'number' },
          ],
        },
      ],
    }),
  ],
});
