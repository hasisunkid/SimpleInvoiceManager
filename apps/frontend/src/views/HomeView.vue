<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { session } from '../session';

/** Start screen – the invoice dashboard (FR-INV-20) replaces this in M6. */
const { t } = useI18n();
</script>

<template>
  <main class="page">
    <h1>{{ t('home.welcome', { name: session.user?.displayName ?? '' }) }}</h1>
    <p class="hint">{{ t('home.comingSoon') }}</p>
  </main>
</template>
