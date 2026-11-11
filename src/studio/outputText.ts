import type { MediaViewerOpener } from '../stores/useSettingsStore';
import type { StudioOutput } from './types';

export function outputTextType(output: StudioOutput): 'text' | 'json' | undefined {
  const type =
    output.displayType && output.displayType !== 'unknown' ? output.displayType : output.mediaItems?.[0]?.displayType;
  return type === 'text' || type === 'json' ? type : undefined;
}

export function outputText(output: StudioOutput): string {
  return typeof output.value === 'string' ? output.value : (JSON.stringify(output.value, null, 2) ?? '');
}

export function textOutputViewerOpener(output: StudioOutput, title: string, downloadName: string): MediaViewerOpener {
  return {
    title,
    currentIndex: 0,
    items: [
      {
        id: output.id,
        kind: 'text',
        label: outputTextType(output) === 'json' ? 'JSON' : 'Text',
        text: outputText(output),
        downloadName,
      },
    ],
  };
}
