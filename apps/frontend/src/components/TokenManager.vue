<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatDate, type DocumentLanguage } from '@sim/domain';
import { api, type ApiToken, type ApiTokenList } from '../api';
import { useErrorText } from '../i18n';

/**
 * FR-MCP-03: personal API tokens for AI assistants. In *Profil* a user creates and revokes own
 * tokens (the secret is shown once); with `admin`, all users' tokens are listed for revoking.
 */
const props = defineProps<{ admin?: boolean }>();
const { t, locale } = useI18n();
const errorText = useErrorText();

const EXPIRY_OPTIONS = [null, 30, 90, 365] as const;

const list = ref<ApiTokenList | null>(null);
const name = ref('');
const expiresInDays = ref<number | null>(null);
const busy = ref(false);
const error = ref('');
const secret = ref('');
const copied = ref(false);
const base = computed(() => (props.admin ? 'admin/tokens' : 'me/tokens'));

/** MCP runs on the direct port; under Home Assistant Ingress its address is not this page's. */
const underIngress = window.location.pathname.includes('/hassio_ingress/');
const mcpUrl = new URL('mcp', document.baseURI).href;

const date = (iso: string) => formatDate(iso.slice(0, 10), locale.value as DocumentLanguage);

function state(token: ApiToken): string {
  if (token.revokedAt) return t('tokens.revoked');
  if (!token.active) return t('tokens.expired');
  return token.lastUsedAt
    ? t('tokens.lastUsed', { date: date(token.lastUsedAt) })
    : t('tokens.neverUsed');
}

async function load(): Promise<void> {
  try {
    list.value = await api.get<ApiTokenList>(base.value);
  } catch (err) {
    error.value = errorText(err);
  }
}

async function create(): Promise<void> {
  error.value = '';
  secret.value = '';
  copied.value = false;
  if (!name.value.trim()) {
    error.value = t('errors.TOKEN_NAME_REQUIRED');
    return;
  }
  busy.value = true;
  try {
    const created = await api.post<{ token: string; item: ApiToken }>('me/tokens', {
      name: name.value.trim(),
      expiresInDays: expiresInDays.value,
    });
    secret.value = created.token;
    name.value = '';
    await load();
  } catch (err) {
    error.value = errorText(err);
  } finally {
    busy.value = false;
  }
}

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(secret.value);
    copied.value = true;
  } catch {
    // Clipboard blocked (e.g. no HTTPS): the key stays visible for manual copying.
  }
}

async function revoke(token: ApiToken): Promise<void> {
  // NFR-UX-03: destructive actions need confirmation.
  if (!window.confirm(t('tokens.revokeConfirm', { name: token.name }))) return;
  error.value = '';
  try {
    await api.delete(`${base.value}/${token.id}`);
    await load();
  } catch (err) {
    error.value = errorText(err);
  }
}

onMounted(load);
</script>

<template>
  <section class="card" data-testid="tokens">
    <h2>{{ t('tokens.title') }}</h2>
    <p class="hint">{{ t('tokens.hint') }}</p>
    <p v-if="list && !list.mcpEnabled" class="alert" role="status">{{ t('tokens.disabled') }}</p>

    <form v-if="!props.admin" class="stack" novalidate @submit.prevent="create">
      <label for="token-name">{{ t('tokens.name') }}</label>
      <input
        id="token-name"
        v-model="name"
        maxlength="100"
        :placeholder="t('tokens.namePlaceholder')"
        autocomplete="off"
      />
      <label for="token-expiry">{{ t('tokens.expiry') }}</label>
      <select id="token-expiry" v-model="expiresInDays">
        <option v-for="days in EXPIRY_OPTIONS" :key="String(days)" :value="days">
          {{ days === null ? t('tokens.expiryNever') : t('tokens.expiryDays', { days }) }}
        </option>
      </select>
      <button type="submit" class="primary" :disabled="busy">{{ t('tokens.create') }}</button>
    </form>

    <div v-if="secret" class="notice stack" role="status">
      <p>{{ t('tokens.created') }}</p>
      <span class="visually-hidden">{{ t('tokens.secret') }}</span>
      <code class="token-secret" data-testid="token-secret">{{ secret }}</code>
      <button type="button" class="secondary" @click="copy">
        {{ copied ? t('tokens.copied') : t('tokens.copy') }}
      </button>
      <p>
        <strong>{{ t('tokens.address') }}</strong>
        <br />
        {{ underIngress ? t('tokens.addressIngress') : mcpUrl }}
      </p>
    </div>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <p v-if="list && list.items.length === 0" class="hint">{{ t('tokens.empty') }}</p>
    <ul v-else-if="list" class="list">
      <li
        v-for="token in list.items"
        :key="token.id"
        class="list__item"
        :class="{ 'list__item--muted': !token.active }"
      >
        <span class="list__title">{{ token.name }}</span>
        <span class="list__sub">
          {{
            [
              props.admin ? t('tokens.owner', { name: token.userName }) : '',
              `${token.prefix}…`,
              state(token),
              token.active && token.expiresAt
                ? t('tokens.expires', { date: date(token.expiresAt) })
                : '',
            ]
              .filter(Boolean)
              .join(' · ')
          }}
        </span>
        <button v-if="token.active" type="button" class="secondary" @click="revoke(token)">
          {{ t('tokens.revoke') }}
        </button>
      </li>
    </ul>
  </section>
</template>
