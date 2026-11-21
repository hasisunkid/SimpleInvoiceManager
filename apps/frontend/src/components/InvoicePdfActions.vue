<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import { useErrorText } from '../i18n';

/**
 * FR-PDF-05: open the stored PDF in the browser's viewer, share it via the OS share sheet
 * (Web Share API with files, where available) or download it.
 */
const props = defineProps<{ invoiceId: number; number: string }>();
const { t } = useI18n();
const errorText = useErrorText();
const error = ref('');
const busy = ref(false);

// Relative URL: works under the Home Assistant ingress path (AR-13); the cookie authenticates.
const pdfUrl = computed(() => `api/invoices/${props.invoiceId}/pdf`);
const canShareFiles =
  typeof navigator !== 'undefined' &&
  typeof navigator.canShare === 'function' &&
  navigator.canShare({ files: [new File([''], 'test.pdf', { type: 'application/pdf' })] });

async function share(): Promise<void> {
  error.value = '';
  busy.value = true;
  try {
    const file = await api.getFile(pdfUrl.value.replace(/^api\//, ''), `${props.number}.pdf`);
    await navigator.share({ files: [file], title: file.name });
  } catch (err) {
    // Closing the share sheet is not an error.
    if (!(err instanceof DOMException && err.name === 'AbortError')) error.value = errorText(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="stack">
    <a :href="pdfUrl" target="_blank" rel="noopener" class="button primary">
      {{ t('editor.openPdf') }}
    </a>
    <button v-if="canShareFiles" type="button" class="secondary" :disabled="busy" @click="share">
      {{ t('editor.sharePdf') }}
    </button>
    <a :href="pdfUrl" download class="button secondary">{{ t('editor.downloadPdf') }}</a>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
  </div>
</template>
