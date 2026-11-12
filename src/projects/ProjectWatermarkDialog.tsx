import type { ComponentProps } from 'react';
import { WatermarkDialog } from '../components/WatermarkDialog';
import { useEditorStore } from '../state/editorStore';

type Props = Pick<ComponentProps<typeof WatermarkDialog>, 'onClose' | 'onNotify' | 'onBusyChange'> & {
  bindToProject: boolean;
};

export function ProjectWatermarkDialog({ bindToProject, ...props }: Props) {
  const projectId = useEditorStore(state => state.project.id);
  const preset = useEditorStore(state => state.outputSettings.watermark);
  return <WatermarkDialog
    key={bindToProject ? projectId : 'standalone-watermark'}
    {...props}
    projectPreset={bindToProject ? preset : undefined}
    onProjectPresetChange={bindToProject ? value => {
      const state = useEditorStore.getState();
      if (state.project.id === projectId) state.updateOutputSettings({ watermark: value });
    } : undefined}
  />;
}
