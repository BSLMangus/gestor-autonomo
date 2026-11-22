import { AIMessage } from "@langchain/core/messages";
import type { QuickAction } from "../../core/contracts/types";
import type { GraphDependencies } from "../ports";
import type { ObraLocalGraphState, ObraLocalGraphUpdate } from "../state";

export function createClarificationNode(deps?: GraphDependencies) {
  return async function clarificationNode(
    state: ObraLocalGraphState
  ): Promise<ObraLocalGraphUpdate> {
    const pending = state.pending_disambiguation;
    let prompt =
      pending?.prompt ?? "¿Podrías confirmar a qué obra, cliente o acción te refieres?";

    if (
      deps?.inference.generateConversationalReply &&
      pending &&
      pending.original_intent === null &&
      !pending.raw_media_uri &&
      pending.original_text.trim().length > 0 &&
      pending.attempts === 0
    ) {
      const recentMessages = state.messages
        .slice(-4)
        .map((m) => ({
          role: (m._getType() === "human" ? "user" : "assistant") as "user" | "assistant",
          content: typeof m.content === "string" ? m.content : "",
        }))
        .filter((m) => m.content.trim().length > 0);
      const llmReply = await deps.inference.generateConversationalReply({
        text: pending.original_text,
        recentMessages,
      });
      if (llmReply?.reply) {
        prompt = llmReply.reply;
      }
    }

    const quickActions: QuickAction[] = (pending?.candidates ?? []).map((cand, idx) => ({
      id: `qa_disamb_${idx}_${cand.id}`,
      label: cand.label.slice(0, 80),
      action_type: "resolve_disambiguation",
      payload: {
        ...(cand.action_choice ? { disambiguation_choice: cand.action_choice } : {}),
        target_ids: {
          ...(cand.job_id ? { job_id: cand.job_id } : {}),
          ...(cand.client_id ? { client_id: cand.client_id } : {}),
          ...(cand.quote_id ? { quote_id: cand.quote_id } : {}),
          ...(cand.catalog_item_id ? { catalog_item_id: cand.catalog_item_id } : {}),
        },
      },
    }));

    return {
      routed_intent: "clarification_node",
      active_widget: null,
      pending_gate: null,
      quick_actions: quickActions.length > 0 ? quickActions : null,
      messages: [new AIMessage(prompt)],
      turn_trace: { append_node: "clarification_node" },
    };
  };
}
