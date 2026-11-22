<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';

/** Admin area: users, invoice design, number range. */
const { t } = useI18n();

const entries = [
  { to: 'users', title: 'settings.users', hint: 'settings.usersHint' },
  { to: 'style', title: 'settings.style', hint: 'settings.styleHint' },
  { to: 'numbering', title: 'settings.numbering', hint: 'settings.numberingHint' },
  { to: 'backup', title: 'settings.export', hint: 'settings.exportHint' },
  { to: 'tokens', title: 'settings.tokens', hint: 'settings.tokensHint' },
] as const;
</script>

<template>
  <main class="page">
    <h1>{{ t('settings.title') }}</h1>
    <ul class="list">
      <li v-for="entry in entries" :key="entry.to">
        <RouterLink :to="{ name: entry.to }" class="list__item">
          <span class="list__title">{{ t(entry.title) }}</span>
          <span class="list__sub">{{ t(entry.hint) }}</span>
        </RouterLink>
      </li>
    </ul>
  </main>
</template>
