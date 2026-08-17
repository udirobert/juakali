import { createContext, use, useState, type ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";

type InvestorSessionValue = {
    selectedCommitmentId: Id<"commitments"> | null;
    setSelectedCommitmentId: (id: Id<"commitments"> | null) => void;
    draftByCommitment: Record<string, string>;
    setDraft: (commitmentId: Id<"commitments">, draft: string) => void;
    activeRunId: Id<"agentRuns"> | null;
    setActiveRunId: (id: Id<"agentRuns"> | null) => void;
};

const InvestorSessionContext = createContext<InvestorSessionValue | null>(null);

export function InvestorSessionProvider({ children }: { children: ReactNode }) {
    const [selectedCommitmentId, setSelectedCommitmentId] =
        useState<Id<"commitments"> | null>(null);
    const [draftByCommitment, setDraftByCommitment] = useState<Record<string, string>>({});
    const [activeRunId, setActiveRunId] = useState<Id<"agentRuns"> | null>(null);

    return (
        <InvestorSessionContext
            value={{
                selectedCommitmentId,
                setSelectedCommitmentId,
                draftByCommitment,
                setDraft: (commitmentId, draft) => {
                    setDraftByCommitment((prev) => ({ ...prev, [commitmentId]: draft }));
                },
                activeRunId,
                setActiveRunId,
            }}
        >
            {children}
        </InvestorSessionContext>
    );
}

export function useInvestorSession() {
    const value = use(InvestorSessionContext);
    if (!value) {
        throw new Error("useInvestorSession requires InvestorSessionProvider");
    }
    return value;
}
