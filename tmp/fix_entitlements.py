import re

path = "server/_lib/starter-entitlements.ts"
with open(path, "r") as f:
    content = f.read()

# Match the mangled single-line function (literal \n sequences in the file)
pattern = r'export async function getUserPlanTier\(db: any, userId: string, now = new Date\(\)\) \{\\n.*?\\n\}'
replacement = (
    "export async function getUserPlanTier(db: any, userId: string, now = new Date()) {\n"
    "  // Join through users so we can also check betaSignups via userId OR\n"
    "  // emailNormalized (for pre-account beta signups).\n"
    "  const [row] = await db\n"
    "    .select({\n"
    "      plan: schema.billingReferences.plan,\n"
    "      betaId: schema.betaSignups.id,\n"
    "      betaTrialEndsAt: schema.betaSignups.trialEndsAt,\n"
    "    })\n"
    "    .from(schema.users)\n"
    "    .leftJoin(\n"
    "      schema.billingReferences,\n"
    "      eq(schema.billingReferences.userId, schema.users.id),\n"
    "    )\n"
    "    .leftJoin(\n"
    "      schema.betaSignups,\n"
    "      or(\n"
    "        eq(schema.betaSignups.userId, schema.users.id),\n"
    "        eq(schema.betaSignups.emailNormalized, sql`lower(trim(${schema.users.email}))`),\n"
    "      ),\n"
    "    )\n"
    "    .where(eq(schema.users.id, userId))\n"
    "    .limit(1);\n"
    "\n"
    "  const billingPlan = normalizePlan(row?.plan);\n"
    "\n"
    "  // If the billing row carries an explicitly elevated plan, use it.\n"
    "  if (billingPlan && billingPlan !== 'starter' && billingPlan !== 'free') {\n"
    "    return billingPlan;\n"
    "  }\n"
    "\n"
    "  // betaSignups entry means Early Access - but only while the trial has not\n"
    "  // expired. NULL trialEndsAt means pre-column row: treat as non-expired.\n"
    "  if (row?.betaId) {\n"
    "    const trialEndsAt = row.betaTrialEndsAt ? new Date(row.betaTrialEndsAt) : null;\n"
    "    if (!trialEndsAt || trialEndsAt > now) {\n"
    "      return 'early_access';\n"
    "    }\n"
    "  }\n"
    "\n"
    "  return billingPlan || 'starter';\n"
    "}"
)

new_content = re.sub(pattern, replacement, content, flags=re.DOTALL)
if new_content == content:
    print("ERROR: pattern did not match - trying literal search")
    idx = content.find(r"getUserPlanTier(db: any, userId: string, now = new Date()) {\n")
    print(f"Literal find idx: {idx}")
    if idx >= 0:
        print(repr(content[idx:idx+200]))
else:
    with open(path, "w") as f:
        f.write(new_content)
    print("OK")
