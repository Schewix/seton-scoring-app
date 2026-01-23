import { defineType, defineArrayMember } from 'sanity';

export const blockContent = defineType({
  name: 'blockContent',
  title: 'Obsah',
  type: 'array',
  of: [
    defineArrayMember({ type: 'block' }),
    defineArrayMember({
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
});
