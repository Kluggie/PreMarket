import pathlib

p = pathlib.Path('server/_lib/vertex-evaluation-v2-prompts.ts')
content = p.read_text('utf-8')
lines = content.splitlines(keepends=True)

# Verify we're targeting the right lines
assert 'Section roles are strict' in lines[701], f"Line 702 mismatch: {lines[701][:60]}"
assert 'coverageCount < 3' in lines[749], f"Line 750 mismatch: {lines[749][:60]}"

replacement_lines = [
    "    hasPriorBilateralContext\n",
    "      ? '- Keep the mediation narrative progress-aware rather than rewriting the whole negotiation from scratch.'\n",
    "      : '',\n",
    "    hasPriorBilateralContext\n",
    "      ? '- When prior_bilateral_context is present, include concrete delta analysis for what changed, what remains open, and whether the negotiation is moving toward agreement.'\n",
    "      : '',\n",
    "    '',\n",
    "    'MEDIATION OUTPUT STYLE \u2014 choose the best visible style for this specific case:',\n",
    "    'Internally, pick the style family that best serves the situation. Do NOT expose the style name. Just write naturally.',\n",
    "    '',\n",
    "    '- Narrative mediation note (good default): 2-4 well-formed paragraphs, prose-led, explains current position, main friction, and likely route forward. Use when there is a credible path and the parties need balanced explanation.',\n",
    "    '- Decision-oriented note: more direct, makes clear whether matter looks viable or blocked, explains what prevents commitment, identifies clearest next step. Use when the issue is near agreement, deadlock, or a meaningful turning point.',\n",
    "    '- Negotiation-path note: emphasizes likely landing zone, what each side needs, surfaces trade-offs, proposes bridge or sequence. Use for scope, pricing, pilot, or staged-commitment situations.',\n",
    "    '- Risk-and-bridge note: keeps meaningful risk analysis but turns it into a proposed bridge. Explains why each side may hesitate, then proposes how to reduce that hesitation. Use when a party is likely to hesitate due to vagueness or poorly allocated risk.',\n",
    "    '- Information-gap note: emphasizes uncertainty rather than conflict, explains what is missing, helps parties see what would unlock progress. Use when the gap is definitional, technical, or operational rather than adversarial.',\n",
    "    '- Near-agreement note: affirms parties are close, identifies remaining points without alarm, encourages focused path to closure. Use when parties appear largely aligned with only a few final issues.',\n",
    "    '- Deadlock-risk note: honest and commercially serious, explains why current path may stall, identifies whether reframing is possible. Use when expectations or risk appetites may be materially misaligned.',\n",
    "    '',\n",
    "    'ADAPTIVE REPORT STRUCTURE:',\n",
    "    '- The why[] array MUST always begin with \"Mediation Summary: \u2026\" (2-3 paragraphs, the main mediation narrative for this case).',\n",
    "    '- The why[] array MUST always contain \"Decision Readiness: \u2026\" which starts with \"Decision status:\" + one of: \"Not viable\", \"Explore further\", \"Proceed with conditions\", or \"Ready to finalize\".',\n",
    "    '- Beyond those two required sections, add 2-5 additional sections using headings that suit this specific case.',\n",
    "    `- Choose from the adaptive heading pool: ${adaptiveHeadings.join(', ')}, OR create a case-specific heading that is natural, concise, and descriptive.`,\n",
    "    '- Do NOT use the same heading set every time. Vary headings based on what the case actually needs.',\n",
    "    '- Do NOT use abstract consultant-style heading labels such as \"Leverage Signals\" or \"Potential Deal Structures\" unless those concepts genuinely serve this specific mediation.',\n",
    "    '- Every section should contribute to the mediation narrative. If a section would only repeat what another section already covers, omit it.',\n",
    "    '- Decision Readiness must also include \"What must be agreed now vs later:\" and \"What would change the verdict:\".',\n",
    "    '',\n",
    "    hasFixedPriceContract\n",
    "      ? 'CONDITIONAL \u2014 fixed-price signals detected: discuss how commercial certainty, acceptance criteria, change-order triggers, and risk allocation shape the analysis.'\n",
    "      : '',\n",
    "    hasAggressiveTimeline\n",
    "      ? 'CONDITIONAL \u2014 urgency signals detected: include an explicit scope-time-budget tradeoff.'\n",
    "      : '',\n",
    "    hasDataSecurity\n",
    "      ? 'CONDITIONAL \u2014 data/integration systems detected: reflect data handling, access control, or compliance containment using abstract public-safe wording.'\n",
    "      : '',\n",
    "    '',\n",
    "    'WHY FIELD \u2014 FORMAT INSTRUCTIONS:',\n",
    "    `- Total combined length of all why[] entries MUST NOT exceed ${whyMaxChars} characters.`,\n",
    "    '- Each why[] element must start with its heading name followed by \": \"',\n",
    "    '  (e.g., \"Mediation Summary: Both sides appear broadly aligned on the core deliverable\u2026\").',\n",
    "    '- Separate paragraphs within one why[] entry using \\\\n\\\\n.',\n",
    "    `- Required headings (always include): ${requiredHeadings.join(', ')}.`,\n",
    "    '- Additional headings: choose 2-5 adaptive headings that suit this case.',\n",
    "    '- Total why[] array should contain 4-7 entries.',\n",
    "    '',\n",
    "    'MISSING FIELD \u2014 QUALITY RULES:',\n",
    "    `- Generate 6-10 items. Maximum ${MISSING_MAX_ITEMS} items. Include ONLY items that materially change feasibility, cost, timeline, or risk.`,\n",
    "    '- Each item must be an actionable question AND include a \"why it matters\" clause after an em-dash (\u2014).',\n",
    "    '  Example: \"What is the event schema and retention policy for the source data? \u2014 determines ingestion approach and governance risk.\"',\n",
    "    '- Questions must address scope clarity, risk allocation, ownership of responsibilities, pricing assumptions, and operational execution.',\n",
    "    '- Order by criticality: contract/deal-blockers first, then technical unknowns, then operational gaps.',\n",
    "    '- Avoid generic questions. Reference the specific proposal context.',\n",
    "    '- Prioritise questions about scope boundary, acceptance criteria, data remediation, dependency ownership, change-order triggers, and critical technical assumptions.',\n",
    "    '- Paraphrase all items from fact_sheet.missing_info and fact_sheet.open_questions as actionable questions with why-matters clauses.',\n",
    "    '- If information appears to exist privately but cannot be shared, prefer placing it in redactions[] rather than restating it as missing[].',\n",
]

# Replace lines 702-750 (1-indexed) = 701-749 (0-indexed)
new_lines = lines[:701] + replacement_lines + lines[750:]
p.write_text(''.join(new_lines), 'utf-8')
print(f'Done. Replaced lines 702-750. Old had {len(lines)} lines, new has {len(new_lines)} lines.')
