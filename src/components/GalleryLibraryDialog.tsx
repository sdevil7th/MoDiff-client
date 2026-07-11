import { Images } from 'lucide-react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { ModiffDialog } from '../ui';
import OutputGalleryPanel from './OutputGalleryPanel';

export default function GalleryLibraryDialog() {
  const open = useSettingsStore((state) => state.galleryLibraryOpen);
  const setOpen = useSettingsStore((state) => state.setGalleryLibraryOpen);

  return (
    <ModiffDialog
      open={open}
      onClose={() => setOpen(false)}
      title={
        <span className="inline-flex min-w-0 items-center gap-2">
          <Images size={17} className="text-hf-yellow" />
          <span className="truncate">Output Gallery</span>
        </span>
      }
      panelClassName="max-w-[1180px]"
      bodyClassName="max-h-[76vh] p-0"
    >
      <OutputGalleryPanel modalView />
    </ModiffDialog>
  );
}
