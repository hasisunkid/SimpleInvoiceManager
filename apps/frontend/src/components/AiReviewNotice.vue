<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import { useErrorText } from '../i18n';

/**
 * FR-MCP-10: note on records created by an AI assistant, with the "Geprüft" confirmation.
 * `path` is the record's API path, e.g. `customers/5`; `reviewed` is emitted once confirmed.
 */
const props = defineProps<{ path: string }>();
const emit = defineEmits<{ reviewed: [] }>();
const { t } = useI18n();
const errorText = useErrorText();
const busy = ref(false);
const error = ref('');

async function confirm(): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    await api.post(`${props.path}/reviewed`, {});
    emit('reviewed');
  } catch (err) {
    error.value = errorText(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="notice notice--ai" role="status" data-testid="ai-notice">
    <p>{{ t('ai.notice') }}</p>
    <button type="button" class="secondary" :disabled="busy" @click="confirm">
      {{ t('ai.reviewed') }}
    </button>
  </div>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
</template>
