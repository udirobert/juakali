export interface ExtractedMasterProfile {
    name: string;
    locationText: string;
    craftText: string;
    keySkills: Array<string>;
    profileSummary: string;
    language: "sw" | "en" | "mixed" | "unknown";
}

const commonCrafts = [
    "carpentry",
    "welding",
    "tailoring",
    "mechanics",
    "masonry",
    "plumbing",
    "electrical",
    "hairdressing",
    "painting",
    "metalwork",
    "woodwork",
    "shoemaking",
];

export function normalizeKey(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "unknown";
}

export function normalizePhone(value: string): string {
    const trimmed = value.trim();
    if (trimmed.startsWith("+")) return trimmed;
    if (trimmed.startsWith("0")) return `+254${trimmed.slice(1)}`;
    if (trimmed.startsWith("254")) return `+${trimmed}`;
    return trimmed;
}

export function cleanText(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

export function splitSkills(value: string): Array<string> {
    const skills = value
        .split(/[,;\n]| and | na /i)
        .map((skill) => cleanText(skill))
        .filter((skill) => skill.length > 1);
    return Array.from(new Set(skills)).slice(0, 6);
}

export function detectCraft(text: string): string {
    const lowerText = text.toLowerCase();
    const craft = commonCrafts.find((candidate) => lowerText.includes(candidate));
    return craft ?? "general artisan skills";
}

export function heuristicExtractMasterProfile(
    transcript: string,
    fallbackPhone: string | null
): ExtractedMasterProfile {
    const cleaned = cleanText(transcript);
    const craftText = detectCraft(cleaned);
    const locationMatch = cleaned.match(/(?:location|town|from|in|at|mji|niko|kutoka)\s+([A-Za-z\s-]{2,30})/i);
    const nameMatch = cleaned.match(/(?:name is|i am|I'm|jina langu ni|naitwa)\s+([A-Za-z\s-]{2,40})/i);
    const skillsMatch = cleaned.match(/(?:teach|skills|nafanya|hufundisha|specialize in)\s+(.{5,160})/i);

    const name = cleanText(nameMatch?.[1] ?? fallbackPhone ?? "Unnamed Master");
    const locationText = cleanText(locationMatch?.[1] ?? "Unknown location");
    const keySkills = splitSkills(skillsMatch?.[1] ?? craftText);

    return {
        name,
        locationText,
        craftText,
        keySkills: keySkills.length > 0 ? keySkills : [craftText],
        profileSummary: cleaned.slice(0, 280),
        language: "unknown",
    };
}

export function scoreMaster(
    masterCraftKey: string,
    masterLocationKey: string,
    requestedCraftKey: string,
    requestedLocationKey: string
): number {
    const craftScore = masterCraftKey === requestedCraftKey ? 70 : 35;
    const locationScore = masterLocationKey === requestedLocationKey ? 30 : 10;
    return craftScore + locationScore;
}
