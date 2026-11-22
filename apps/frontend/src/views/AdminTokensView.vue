<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import TokenManager from '../components/TokenManager.vue';

/** FR-MCP-03: administrators see the AI access keys of all users and can revoke them. */
const { t } = useI18n();
</script>

<template>
  <main class="page">
    <h1>{{ t('settings.tokens') }}</h1>
    <TokenManager admin />
  </main>
</template>
