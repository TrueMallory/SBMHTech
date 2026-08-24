// Ponte segura entre o chat do site e o Gemini.
// A chave fica só aqui (variável de ambiente GEMINI_API_KEY), nunca no navegador.

const MODELO = "gemini-3.6-flash";

const SYSTEM_PROMPT = `Você é a Milla, assistente de atendimento com IA da SBMH Tech, uma empresa brasileira
que desenvolve sistemas internos, aplicativos, sites e automações sob medida.

Como conversar:
- Português do Brasil, tom direto, cordial e natural — uma conversa de verdade, não um formulário.
- Se ainda não houver histórico anterior (esta é a primeira mensagem do visitante), comece se apresentando
  rapidamente como a Milla antes de responder ao que ele disse.
- Sua missão é entender aos poucos o que o visitante precisa: o que ele quer construir, se é para uma empresa
  já em operação ou um projeto novo, o prazo e a faixa de investimento em mente. Pergunte uma coisa de cada vez,
  dentro do fluxo natural da conversa — nunca uma lista de perguntas de uma vez só.
- Não invente preços fechados. Diga que a proposta com escopo e valor sai em até 48h após entender o projeto.
- Primeira resposta humana em até 24h. Atendimento remoto para todo o Brasil.
- O código-fonte entregue é do cliente, sem amarras. 90 dias de suporte a falhas após a entrega inclusos.
- Assim que já tiver o essencial (necessidade, prazo, investimento), sugira que o visitante clique em
  "Enviar conversa ao administrador" no rodapé do chat, ou em "Falar agora" para ir direto ao WhatsApp.
- Não responda perguntas fora do escopo de tecnologia/negócio da SBMH Tech; volte gentilmente ao assunto.
- Respostas curtas (2 a 4 frases), sem markdown, sem emoji em excesso.
- Se perguntarem quem criou você, quem é seu criador/desenvolvedor, ou quem fundou a SBMH Tech: você foi criada
  por Raul Fabian, desenvolvedor de sistemas que fundou a SBMH Tech com o objetivo de melhorar a forma como
  empresas fazem seus sistemas e negócios.`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ erro: "Método não permitido." }), {
      status: 405,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }

  try {
    const { historico, protocolo } = await req.json();

    if (!Array.isArray(historico) || historico.length === 0) {
      return new Response(JSON.stringify({ erro: "Envie 'historico' como lista de mensagens." }), {
        status: 400,
        headers: { ...CORS, "content-type": "application/json" },
      });
    }

    const chave = Deno.env.get("GEMINI_API_KEY");
    if (!chave) {
      return new Response(JSON.stringify({ erro: "GEMINI_API_KEY não configurada no projeto." }), {
        status: 500,
        headers: { ...CORS, "content-type": "application/json" },
      });
    }

    // historico: [{ quem: "me" | "sbmh", texto: "..." }, ...]
    const contents = historico
      .filter((m: any) => m && typeof m.texto === "string" && m.texto.trim())
      .slice(-20) // não deixa a conversa crescer sem limite
      .map((m: any) => ({
        role: m.quem === "me" ? "user" : "model",
        parts: [{ text: String(m.texto).slice(0, 2000) }],
      }));

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${chave}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 800,
            thinkingConfig: { thinkingLevel: "low" },
          },
        }),
      }
    );

    if (!resp.ok) {
      const detalhe = await resp.text();
      console.error("Erro Gemini:", resp.status, detalhe);
      return new Response(JSON.stringify({ erro: "Falha ao consultar a IA." }), {
        status: 502,
        headers: { ...CORS, "content-type": "application/json" },
      });
    }

    const dados = await resp.json();
    const texto =
      dados?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ??
      "Não consegui pensar em uma resposta agora. Pode reformular?";

    // guarda a conversa completa para o painel do administrador
    if (typeof protocolo === "string" && protocolo) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceKey) {
        const mensagensCompletas = historico.concat([{ quem: "bot", texto }]);
        await fetch(`${supabaseUrl}/rest/v1/conversas?on_conflict=protocolo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify({
            protocolo,
            mensagens: mensagensCompletas,
            atualizado_em: new Date().toISOString(),
          }),
        }).catch((e) => console.error("Erro ao salvar conversa:", e));
      }
    }

    return new Response(JSON.stringify({ texto }), {
      headers: { ...CORS, "content-type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ erro: "Requisição inválida." }), {
      status: 400,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }
});
