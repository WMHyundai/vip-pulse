// Supabase Edge Function: score-priority
// 프론트엔드(app.js)에서 감지한 이벤트 후보를 받아 Claude API로 우선순위 점수·긴급도·
// 추천 대응 문구를 생성해 돌려준다. ANTHROPIC_API_KEY는 이 함수(서버 측)에만 존재하며
// 브라우저로는 절대 전달되지 않는다.
//
// 배포: supabase functions deploy score-priority
// 시크릿 등록: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from "npm:@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          priority_score: { type: "integer" },
          urgency: { type: "string", enum: ["high", "medium", "low"] },
          recommended_action: { type: "string" },
        },
        required: ["event_id", "priority_score", "urgency", "recommended_action"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `당신은 증권사 PB(프라이빗뱅커)를 보조하는 AI 어시스턴트입니다.
아래 VIP 고객 이벤트 목록을 분석해 각 이벤트의 우선순위 점수(1~100, 높을수록 시급),
긴급도(high/medium/low), PB가 취해야 할 구체적인 한국어 대응 문구를 한 문장으로 생성하세요.

우선순위 판단 기준:
- 자산 규모가 크고 부정적 신호(급격한 자산 감소, 평소 대비 매우 큰 규모의 출금·이체)일수록 높게 평가
- 상품 만기 임박은 재예치·재상담 기회이므로 자산 감소·이상 거래보다는 상대적으로 낮게 평가
- 단순 자산 증가는 이탈 위험이 낮으므로 가장 낮게 평가
- 동일 고객에게 여러 이벤트가 겹치면 더 높게 평가

입력에는 각 이벤트의 event_id, 고객명, 자산 총액(억원), 이벤트 유형, 상세 근거, 참고용 규칙 기반 점수가 포함됩니다.
반드시 입력에 있는 모든 event_id에 대해 결과를 하나씩 생성하세요.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { events } = await req.json();

    if (!Array.isArray(events) || events.length === 0) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 4096,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: RESULT_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(events) }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock) {
      throw new Error("Claude 응답에서 텍스트 블록을 찾을 수 없습니다.");
    }

    return new Response(textBlock.text, {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
