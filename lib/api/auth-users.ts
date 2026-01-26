export type AuthUserSummary = {
  id: string;
  email: string | null;
  user_metadata: Record<string, unknown>;
};

export async function getAuthUsers(): Promise<AuthUserSummary[]> {
  try {
    const response = await fetch("/api/auth-users", { cache: "no-store" });
    if (!response.ok) {
      console.error("getAuthUsers failed:", response.status);
      return [];
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("getAuthUsers request error:", error);
    return [];
  }
}
