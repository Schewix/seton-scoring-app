import { useMemo } from 'react';
import { Stack, Text, TextInput } from '@sanity/ui';
import type { StringInputProps } from 'sanity';
import { set, unset } from 'sanity';

const DRIVE_FOLDER_PATTERNS = [
  /folders\/([a-zA-Z0-9_-]+)/,
  /id=([a-zA-Z0-9_-]+)/,
];

function extractFolderId(input: string) {
  for (const pattern of DRIVE_FOLDER_PATTERNS) {
    const match = input.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

export function DriveFolderInput(props: StringInputProps) {
  const { value, elementProps, onChange } = props;
  const currentValue = typeof value === 'string' ? value : '';

  const helper = useMemo(() => {
    if (!currentValue) {
      return 'Vlož ID nebo URL složky z Google Drive. URL se automaticky převede na ID.';
    }
    if (currentValue.startsWith('http')) {
      return 'URL byla převedena na ID složky.';
    }
    return 'Uložené ID složky lze kdykoli nahradit jiným.';
  }, [currentValue]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.currentTarget.value;
    const trimmed = raw.trim();
    if (!trimmed) {
      onChange(unset());
      return;
    }
    const extracted = extractFolderId(trimmed);
    onChange(set(extracted ?? trimmed));
  };

  return (
    <Stack space={2}>
      <TextInput
        {...elementProps}
        value={currentValue}
        onChange={handleChange}
        placeholder="https://drive.google.com/drive/folders/... nebo ID složky"
      />
      <Text size={1} muted>
        {helper}
      </Text>
    </Stack>
  );
}
