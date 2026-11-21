<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';

/** NFR-DATA-02: administrators download all data (JSON) and all PDFs (ZIP). */
const { t } = useI18n();
// Relative URLs (Ingress, AR-13); the session cookie authenticates the download.
const DATA_URL = 'api/admin/export/data';
const PDF_URL = 'api/admin/export/pdfs';
</script>

<template>
  <main class="page">
    <RouterLink :to="{ name: 'settings' }" class="back-link">{{ t('common.back') }}</RouterLink>
    <h1>{{ t('backup.title') }}</h1>
    <p class="hint">{{ t('backup.hint') }}</p>

    <section class="card">
      <h2>{{ t('backup.dataTitle') }}</h2>
      <p class="hint">{{ t('backup.dataHint') }}</p>
      <a :href="DATA_URL" download class="button primary">{{ t('backup.dataDownload') }}</a>
    </section>

    <section class="card">
      <h2>{{ t('backup.pdfTitle') }}</h2>
      <p class="hint">{{ t('backup.pdfHint') }}</p>
      <a :href="PDF_URL" download class="button primary">{{ t('backup.pdfDownload') }}</a>
    </section>

    <p class="notice">{{ t('backup.haHint') }}</p>
  </main>
</template>
