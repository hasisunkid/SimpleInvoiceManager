<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/** AR-26: the running version, linked to its GitHub release notes (none for local builds). */
defineProps<{ version: string; releaseNotesUrl: string | null }>();

const { t } = useI18n();
</script>

<template>
  <p class="app-version">
    <a
      v-if="releaseNotesUrl"
      :href="releaseNotesUrl"
      target="_blank"
      rel="noopener noreferrer"
      :aria-label="t('app.releaseNotes', { version })"
      data-testid="app-version"
      >{{ t('app.version', { version }) }}</a
    >
    <span v-else data-testid="app-version">{{ t('app.version', { version }) }}</span>
  </p>
</template>

<style scoped>
.app-version {
  margin: 1rem 0 0;
  text-align: center;
  font-size: 0.875rem;
  color: var(--muted);
}
.app-version a {
  color: inherit;
  display: inline-block;
  min-height: 44px;
  line-height: 44px;
}
</style>
