/**
 * Team Mode system prompt — instructs Opus to orchestrate web searches
 * via Grok or Gemini (Google Search Grounding).
 */

import type { Locale } from '../stores/settingsStore';

export function generateTeamPrompt(
  locale: Locale,
  maxRounds: number,
  backend: 'grok' | 'gemini' = 'grok',
  geminiModel?: string,
): string {
  if (backend === 'gemini') {
    return generateGeminiPrompt(locale, maxRounds, geminiModel || 'gemini-2.5-flash');
  }
  return generateGrokPrompt(locale, maxRounds);
}

function generateGrokPrompt(locale: Locale, maxRounds: number): string {
  if (locale === 'zh') {
    return `[团队模式] 你可以通过 Bash 工具执行 \`opencli grok chat "搜索查询"\` 来调用 Grok 进行网络搜索调研。

使用指南：
1. 分析用户需求，判断是否需要网络搜索获取最新信息
2. 如果用户用中文提问，将搜索关键词翻译为英文以获得更好的搜索结果
3. 执行搜索后，分析返回结果，判断是否需要进一步追问（最多 ${maxRounds} 轮搜索）
4. 在最终回答中引用来源，使用编号链接格式，如 [1] Title - URL
5. 保留原始数据和 URL，确保来源可追溯
6. 每次搜索使用不同的关键词以获取更全面的信息

注意：直接使用 Bash 执行 opencli grok chat 命令，不要尝试其他方式调用 Grok。`;
  }

  return `[Team Mode] You can use the Bash tool to execute \`opencli grok chat "search query"\` to invoke Grok for web research.

Guidelines:
1. Analyze the user's request and determine if web search is needed for up-to-date information
2. If the user asks in Chinese, translate search keywords to English for better results
3. After each search, analyze results and determine if follow-up searches are needed (max ${maxRounds} rounds)
4. Cite sources in your final answer using numbered links, e.g. [1] Title - URL
5. Preserve original data and URLs for traceability
6. Use different keywords for each search to get comprehensive coverage

Note: Execute opencli grok chat commands directly via Bash. Do not attempt other ways to invoke Grok.`;
}

function generateGeminiPrompt(locale: Locale, maxRounds: number, model: string): string {
  const curlTemplate = `curl -s "https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=$GEMINI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"contents":[{"parts":[{"text":"SEARCH_QUERY"}]}],"tools":[{"google_search":{}}]}' \\
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
c = d.get('candidates',[{}])[0]
# Print text response
for p in c.get('content',{}).get('parts',[]):
    if 'text' in p: print(p['text'])
# Print sources
gm = c.get('groundingMetadata',{})
for ch in gm.get('groundingChunks',[]):
    w = ch.get('web',{})
    if w.get('uri'): print(f'[Source] {w.get(\"title\",\"\")} - {w[\"uri\"]}')
"`;

  if (locale === 'zh') {
    return `[团队模式] 你可以通过 Bash 工具执行 curl 命令调用 Gemini（Google Search Grounding）进行网络搜索调研。

使用以下命令模板（将 SEARCH_QUERY 替换为实际搜索内容）：

\`\`\`bash
${curlTemplate}
\`\`\`

使用指南：
1. 分析用户需求，判断是否需要网络搜索获取最新信息
2. 如果用户用中文提问，将搜索关键词翻译为英文以获得更好的搜索结果
3. 执行搜索后，分析返回结果，判断是否需要进一步追问（最多 ${maxRounds} 轮搜索）
4. 在最终回答中引用来源，使用编号链接格式，如 [1] Title - URL
5. 保留原始数据和 URL，确保来源可追溯
6. 每次搜索使用不同的关键词以获取更全面的信息

关键点：
- API Key 通过环境变量 $GEMINI_API_KEY 传入，不要在命令中硬编码
- 响应的文本内容在 candidates[0].content.parts[0].text
- 来源在 candidates[0].groundingMetadata.groundingChunks[].web 中（含 uri 和 title）
- 使用 python3 管道精简输出，避免原始 JSON 浪费上下文`;
  }

  return `[Team Mode] You can use the Bash tool to execute curl commands to invoke Gemini (Google Search Grounding) for web research.

Use the following command template (replace SEARCH_QUERY with actual search content):

\`\`\`bash
${curlTemplate}
\`\`\`

Guidelines:
1. Analyze the user's request and determine if web search is needed for up-to-date information
2. If the user asks in Chinese, translate search keywords to English for better results
3. After each search, analyze results and determine if follow-up searches are needed (max ${maxRounds} rounds)
4. Cite sources in your final answer using numbered links, e.g. [1] Title - URL
5. Preserve original data and URLs for traceability
6. Use different keywords for each search to get comprehensive coverage

Key points:
- API Key is passed via $GEMINI_API_KEY environment variable — never hardcode it
- Text response is in candidates[0].content.parts[0].text
- Sources are in candidates[0].groundingMetadata.groundingChunks[].web (with uri and title)
- Use the python3 pipe to condense output and avoid wasting context with raw JSON`;
}
