<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/** FR-MCP-10: "Von KI erstellt" – created by an AI assistant, not yet checked by a person. */
const { t } = useI18n();
</script>

<template>
  <span class="badge badge--ai">{{ t('ai.badge') }}</span>
</template>
