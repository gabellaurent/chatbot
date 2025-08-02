import { supabase } from './supabaseClient.js';

const SESSION_UUID = '13b35ace-a1d0-4161-9f67-e43dca7c62a6';
let heartbeatInterval = null;

export async function checkAndUpdateSession() {
  console.log('Iniciando verificação da sessão...');
  // Busca a linha da sessão
  const { data, error } = await supabase
    .from('chatbot_sessions')
    .select('id, last_seen')
    .eq('id', SESSION_UUID)
    .single();

  // Loga o resultado bruto da busca
  console.log('Resultado da busca:', { data, error });
  if (data && data.last_seen) {
    console.log('Valor de last_seen retornado:', data.last_seen);
  }

  if (error) {
    console.error('Erro ao buscar sessão:', error);
    return false;
  }

  if (!data || !data.last_seen) {
    console.warn('Sessão não encontrada ou sem last_seen.');
    return false;
  }

  const lastSeen = new Date(data.last_seen);
  const now = new Date();
  const diffSeconds = (now - lastSeen) / 1000;
  console.log('lastSeen (Date):', lastSeen, 'now:', now, 'diffSeconds:', diffSeconds);

  // Se a data NÃO for mais antiga que 40s atrás, NÃO exibe o chat, mantém a tela de verificação
  if (diffSeconds <= 40) {
    const container = document.querySelector('.chatbot-container');
    if (container) container.style.display = '';
    const chatArea = document.querySelector('.chat-area');
    if (chatArea) chatArea.style.display = 'none';
    console.log('last_seen está recente. Chat NÃO exibido, tela de verificação mantida.');
    // Para o heartbeat se estava rodando
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    return false;
  } else {
    // Se for antiga, atualiza o last_seen normalmente e exibe o chat
    const { error: updateError } = await supabase
      .from('chatbot_sessions')
      .update({ last_seen: now.toISOString() })
      .eq('id', SESSION_UUID);
    if (updateError) {
      console.error('Erro ao atualizar last_seen:', updateError);
      return false;
    }
    console.log('last_seen estava antigo e foi atualizado. Chat exibido.');
    const container = document.querySelector('.chatbot-container');
    if (container) container.style.display = 'none';
    const chatArea = document.querySelector('.chat-area');
    if (chatArea) chatArea.style.display = 'flex';
    // Inicia o heartbeat para atualizar last_seen a cada 30s
    startHeartbeat();
    return true;
  }
}

function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  // Atualiza imediatamente
  updateLastSeen();
  // Atualiza a cada 30s
  heartbeatInterval = setInterval(updateLastSeen, 30000);
}

async function updateLastSeen() {
  const now = new Date();
  const { error } = await supabase
    .from('chatbot_sessions')
    .update({ last_seen: now.toISOString() })
    .eq('id', SESSION_UUID);
  if (error) {
    console.error('Erro ao atualizar last_seen (heartbeat):', error);
  } else {
    console.log('last_seen atualizado pelo heartbeat:', now.toISOString());
  }
}

// Executa ao carregar a página e mostra no console o resultado
window.addEventListener('DOMContentLoaded', async () => {
  const chatLoaded = await checkAndUpdateSession();

  // Adiciona envio de mensagem e exibição do balão do usuário
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  const messagesArea = document.getElementById('messagesArea');

  // Se o chat foi liberado, limpa a tabela e adiciona mensagem de boas-vindas
  if (chatLoaded && messagesArea) {
    // Limpa a tabela 'conversas'
    await supabase.from('conversas').delete().not('id', 'is', null);
    // Adiciona mensagem de boas-vindas
    const { data, error } = await supabase.from('conversas').insert([
      {
        pergunta: null,
        resposta: 'Olá, bem vindo. Como posso te ajudar hoje?',
        created_at: new Date().toISOString(),
        respondido: false,
        status: null
      }
    ]).select();
    if (error) {
      console.error('Erro ao inserir mensagem de boas-vindas:', error);
    } else if (data && data[0] && data[0].resposta) {
      // Exibe a mensagem do chatbot
      const div = document.createElement('div');
      div.className = 'message bot';
      div.textContent = data[0].resposta;
      messagesArea.appendChild(div);
      messagesArea.scrollTop = messagesArea.scrollHeight;
    }
  }

  if (chatForm && chatInput && messagesArea) {
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = chatInput.value.trim();
      if (!msg) return;
      // Adiciona o balão do usuário
      const div = document.createElement('div');
      div.className = 'message user';
      div.textContent = msg;
      messagesArea.appendChild(div);
      messagesArea.scrollTop = messagesArea.scrollHeight;
      chatInput.value = '';
      // Insere a mensagem do usuário na tabela 'conversas'
      const { data, error } = await supabase.from('conversas').insert([
        {
          pergunta: msg,
          resposta: null,
          created_at: new Date().toISOString(),
          respondido: false,
          status: null
        }
      ]).select();
      if (error) {
        console.error('Erro ao inserir mensagem do usuário:', error);
      }
      // Adiciona o balão do chatbot com animação de "escrevendo" e marca com id
      let insertedId = null;
      if (data && data[0] && data[0].id) {
        insertedId = data[0].id;
      }
      const botDiv = document.createElement('div');
      botDiv.className = 'message bot';
      botDiv.setAttribute('data-msgid', insertedId || 'pending');
      botDiv.innerHTML = 'O chatbot está escrevendo uma mensagem <span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>';
      messagesArea.appendChild(botDiv);
      messagesArea.scrollTop = messagesArea.scrollHeight;
    });

    // Realtime: escuta atualizações na tabela conversas
    supabase
      .channel('conversas-updates')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversas' }, payload => {
        const msg = payload.new;
        // Substitui o balão "escrevendo" pela resposta do bot
        const botDiv = messagesArea.querySelector('[data-msgid="' + msg.id + '"]');
        if (botDiv && msg.resposta) {
          botDiv.textContent = msg.resposta;
        }
      })
      .subscribe();
  }
});
