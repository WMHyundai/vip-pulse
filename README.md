# VIP Pulse — 설정 및 실행 안내

## 1. 로컬에서 열어보기

`fetch`로 Supabase Edge Function을 호출하기 때문에 `file://`로 바로 열지 말고 반드시 정적 서버로 구동해야 합니다.

```bash
# 예: Python이 있다면
python -m http.server 8080

# 예: Node가 있다면
npx serve .
```

브라우저에서 `http://localhost:8080` 접속. Supabase 테이블/Edge Function을 아직 배포하지 않았다면
"저장된 대응 상태를 불러오지 못했습니다" / "AI 우선순위 분석에 실패해 규칙 기반 점수로 표시합니다"
토스트가 뜨는 것이 정상입니다(2번을 완료하면 사라집니다).

## 2. Supabase 설정 (배포는 아직 하지 않았습니다 — 아래는 준비 단계 안내)

1. **테이블 생성**: Supabase 프로젝트의 SQL Editor에서 `supabase/sql/event_actions.sql`과 `supabase/sql/event_log.sql` 내용을 순서대로 실행합니다.
2. **Edge Function 배포**:
   ```bash
   supabase functions deploy score-priority
   ```
3. **Anthropic API 키 등록** (Edge Function 서버 측에만 저장되며 브라우저에는 노출되지 않습니다):
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   ```
4. `app.js` 상단의 `SUPABASE_URL` / `SUPABASE_ANON_KEY`가 실제 사용할 프로젝트 값과 일치하는지 확인합니다.
   (Claude-실습 프로젝트와 같은 Supabase 프로젝트를 재사용하는 경우 별도 수정이 필요 없습니다.)

## 3. 검증 체크리스트 (PRD3.md 6번 기준)

- [ ] 3개 이상 이벤트 유형(자산 급감/급증, 만기 임박, 이상 거래)이 자동 감지·표시되는지
- [ ] AI 우선순위 정렬과 이벤트별 추천 문구가 표시되는지 (2번 완료 후)
- [ ] 이벤트 상태 변경/메모 저장이 즉시 반영되고 새로고침 후에도 유지되는지
- [ ] 고객 상세에서 자산 추이·보유 상품 만기·이벤트 이력이 한 화면에 표시되는지
- [ ] "새로고침" 버튼 클릭 시 우선순위 리스트가 갱신되는지
- [ ] 대시보드 진입 즉시 최상위 우선순위 고객을 확인할 수 있는지
