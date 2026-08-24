// Ponte segura entre o chat do site e o Gemini.
// A chave fica só aqui (variável de ambiente GEMINI_API_KEY), nunca no navegador.

const MODELO = "gemini-3.6-flash";

const SYSTEM_PROMPT = `Você é o atendimento virtual da SBMH Technology, uma empresa brasileira que desenvolve
sistemas internos, aplicativos, sites e automações sob medida.

Como responder:
- Português do Brasil, tom direto, cordial e objetivo. Frases curtas.
- Foco em entender a necessidade do visitante (o que ele precisa, para que serve, prazo) e conduzir para um orçamento.
- Não invente preços fechados. Diga que a proposta com escopo e valor sai em até 48h após entender o projeto.
- Primeira resposta humana em até 24h. Atendimento remoto para todo o Brasil.
- O código-fonte entregue é do cliente, sem amarras. 90 dias de suporte a falhas após a entrega inclusos.
- Se o visitante quiser falar com um humano ou fechar algo, direcione para o botão "Falar agora" (WhatsApp) do site.
- Não responda perguntas fora do escopo de tecnologia/negócio da SBMH Tech; volte gentilmente ao assunto.
- Respostas curtas (2 a 4 frases), sem markdown, sem emoji em excesso.`;

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
    const { historico } = await req.json();

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
