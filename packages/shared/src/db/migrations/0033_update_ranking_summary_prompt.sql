UPDATE "user_settings"
SET "ranking_prompt" = replace(
  "ranking_prompt",
  $old$- digest.summary: One sentence in "Plus: …" form covering the next 3 most notable stories (not the lead). Each clause names the actor and what they did. End with a period.$old$,
  $new$- digest.summary: One sentence in "Plus: …" form covering the next 3 most notable stories from ranks 2 and lower. digest.summary must not mention the rank-1 story, the rank-1 title, the rank-1 actor/company/product, or any rank-1-specific number/model. Treat the rank-1 story as already covered by digest.headline. If the rank-1 item is DeepSeek, DeepSeek cannot appear in digest.summary. Each clause names a non-lead actor and what they did. End with a period.$new$
)
WHERE "ranking_prompt" LIKE '%- digest.summary: One sentence in "Plus: …" form covering the next 3 most notable stories (not the lead). Each clause names the actor and what they did. End with a period.%';
