<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { LANGUAGES, type Language } from '@sim/i18n';
import { apiGet, type Health } from '../api';
import { rememberLanguage } from '../i18n';

const { t, locale } = useI18n();

const username = ref('');
const password = ref('');
const stayLoggedIn = ref(true);
const serverUnreachable = ref(false);

function changeLanguage(event: Event): void {
  const language = (event.target as HTMLSelectElement).value as Language;
  locale.value = language;
  rememberLanguage(language);
}

function submit(): void {
  // Authentication is implemented in milestone M1 (FR-AUTH-*).
}

onMounted(async () => {
  try {
    const health = await apiGet<Health>('health');
    serverUnreachable.value = health.status !== 'ok';
  } catch {
    serverUnreachable.value = true;
  }
});
</script>

<template>
  <main class="login">
    <header class="login__brand">
      <span class="login__accent" aria-hidden="true"></span>
      <h1>{{ t('app.name') }}</h1>
    </header>

    <form class="card" novalidate @submit.prevent="submit">
      <h2>{{ t('login.title') }}</h2>

      <p v-if="serverUnreachable" class="alert" role="alert">
        {{ t('status.serverUnreachable') }}
      </p>

      <label for="username">{{ t('login.username') }}</label>
      <input
        id="username"
        v-model="username"
        name="username"
        autocomplete="username"
        autocapitalize="none"
        required
      />

      <label for="password">{{ t('login.password') }}</label>
      <input
        id="password"
        v-model="password"
        name="password"
        type="password"
        autocomplete="current-password"
        required
      />

      <label class="checkbox">
        <input v-model="stayLoggedIn" type="checkbox" name="stayLoggedIn" />
        {{ t('login.stayLoggedIn') }}
      </label>

      <button type="submit" class="primary">{{ t('login.submit') }}</button>
    </form>

    <footer class="login__footer">
      <label for="language">{{ t('language.label') }}</label>
      <select id="language" :value="locale" @change="changeLanguage">
        <option v-for="lang in LANGUAGES" :key="lang" :value="lang">
          {{ t(`language.${lang}`) }}
        </option>
      </select>
    </footer>
  </main>
</template>
