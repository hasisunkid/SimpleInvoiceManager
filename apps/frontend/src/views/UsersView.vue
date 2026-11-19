<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, type PublicUser } from '../api';
import { useErrorText } from '../i18n';
import { session } from '../session';

/** FR-AUTH-04: user list (admin). */
const { t } = useI18n();
const errorText = useErrorText();

const users = ref<PublicUser[] | null>(null);
const error = ref('');

onMounted(async () => {
  try {
    users.value = await api.get<PublicUser[]>('users');
  } catch (err) {
    error.value = errorText(err);
  }
});
</script>

<template>
  <main class="page">
    <div class="page__head">
      <h1>{{ t('users.title') }}</h1>
      <RouterLink :to="{ name: 'user-new' }" class="button primary">{{
        t('users.new')
      }}</RouterLink>
    </div>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-else-if="!users" class="hint">{{ t('common.loading') }}</p>

    <ul v-else class="list">
      <li v-for="user in users" :key="user.id">
        <RouterLink
          :to="{ name: 'user-edit', params: { id: user.id } }"
          class="list__item"
          :class="{ 'list__item--muted': !user.active }"
        >
          <span class="list__title">{{ user.displayName }}</span>
          <span class="list__sub">{{ user.username }}</span>
          <span class="badges">
            <span class="badge" :class="{ 'badge--accent': user.role === 'ADMIN' }">
              {{ t(`roles.${user.role}`) }}
            </span>
            <span v-if="!user.active" class="badge badge--danger">{{ t('users.inactive') }}</span>
            <span v-if="user.mustChangePassword && user.active" class="badge">
              {{ t('users.mustChange') }}
            </span>
            <span v-if="user.id === session.user?.id" class="badge">{{ t('users.you') }}</span>
          </span>
        </RouterLink>
      </li>
    </ul>
  </main>
</template>
