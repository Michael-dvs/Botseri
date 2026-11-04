import { prisma } from "@/lib/db";
import { PromptEditor } from "./PromptEditor";

export const dynamic = "force-dynamic";

export default async function PromptPage() {
  const settings = await prisma.botSettings.findUniqueOrThrow({
    where: { id: 1 },
  });

  return (
    <PromptEditor
      initialMode={settings.prompt_mode}
      initialTemplate={settings.custom_prompt_template ?? ""}
      compiledPrompt={settings.compiled_prompt ?? ""}
      version={settings.compiled_prompt_version}
    />
  );
}
