import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Actual registry/starter publication only: no executable node construction. */
export function captureAudioSchemaFixture() {
  const backend = process.env.MODIFF_BACKEND_DIR || path.resolve('../MoDiff');
  const python =
    process.env.MODIFF_BACKEND_PYTHON ||
    path.join(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const selections = ['ACE-Step', 'Runware'].flatMap((repository) =>
    ['text_to_audio', 'audio_variation', 'audio_continuation', 'audio_repaint'].map((task) => ({
      id: `ace:${repository}:${task}`,
      selection: {
        schemaVersion: 1,
        pipelineClass: 'AceStepPipeline',
        task,
        executionProfileId: 'ace-step-audio:direct',
        repository:
          repository === 'ACE-Step' ? 'ACE-Step/acestep-v15-xl-turbo-diffusers' : 'Runware/acestep-v15-turbo-diffusers',
        bindingSpec: { modelType: 'AceStepAudioPipeline', mode: task },
        authoringRecipeId: 'generic-audio-recipe:v1',
      },
    })),
  );
  selections.push({
    id: 'ace:ACE-Step-Base:audio_variation',
    selection: {
      schemaVersion: 1,
      pipelineClass: 'AceStepPipeline',
      task: 'audio_variation',
      executionProfileId: 'ace-step-audio:direct',
      repository: 'ACE-Step/acestep-v15-xl-base-diffusers',
      bindingSpec: { modelType: 'AceStepAudioPipeline', mode: 'audio_variation' },
      authoringRecipeId: 'generic-audio-recipe:v1',
    },
  });
  selections.push({
    id: 'minimax:text_to_audio',
    selection: {
      schemaVersion: 1,
      pipelineClass: 'MiniMaxMusic3ModularPipeline',
      task: 'text_to_audio',
      executionProfileId: 'minimax-music3:official-modular-workflow',
      bindingSpec: { modelType: 'MiniMaxMusic3ModularPipeline', mode: 'text_to_audio' },
    },
  });
  for (const pipelineClass of ['StableAudioPipeline', 'LongCatAudioDiTPipeline', 'AudioLDM2Pipeline'])
    selections.push({ id: `${pipelineClass}:text_to_audio`, selection: { pipelineClass, task: 'text_to_audio' } });
  selections.push({
    id: 'lyric-video-secondary',
    selection: {
      pipelineClass: 'LTXConditionPipeline',
      task: 'image_to_video',
      executionProfileId: 'ltx-video:direct',
      bindingSpec: { modelType: 'LTXVideoPipeline', mode: 'image_to_video' },
      authoringRecipeId: 'generic-video-stages:v1',
    },
  });
  const fixture = JSON.parse(
    execFileSync(python, [path.resolve('scripts/template-operation-fixtures.py')], {
      cwd: backend,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
      env: {
        ...process.env,
        MODIFF_BACKEND_DIR: backend,
        CUDA_VISIBLE_DEVICES: '',
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
        PYTHONDONTWRITEBYTECODE: '1',
      },
      input: JSON.stringify(selections),
    }),
  );
  fixture.secondaryVideo = fixture.recipes.find((row) => row.id === 'lyric-video-secondary');
  fixture.recipes = fixture.recipes.filter((row) => row !== fixture.secondaryVideo);
  return fixture;
}
