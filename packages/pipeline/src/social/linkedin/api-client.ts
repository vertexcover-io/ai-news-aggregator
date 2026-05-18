import type {
  LinkedInApiClient,
  LinkedInCreateCommentInput,
  LinkedInCreateCommentResult,
  LinkedInCreatePostInput,
  LinkedInCreatePostResult,
} from "./types.js";

const POSTS_ENDPOINT = "https://api.linkedin.com/rest/posts";
const SOCIAL_ACTIONS_BASE = "https://api.linkedin.com/rest/socialActions";

interface LinkedInInputError {
  code?: string;
}

interface LinkedInErrorBody {
  errorDetails?: {
    inputErrors?: LinkedInInputError[];
  };
}

function extractErrorCode(rawBody: string): string | undefined {
  try {
    const parsed = JSON.parse(rawBody) as LinkedInErrorBody;
    const code = parsed.errorDetails?.inputErrors?.[0]?.code;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

export interface CreateLinkedInApiClientOptions {
  fetchFn?: typeof fetch;
}

export function createLinkedInApiClient(
  options: CreateLinkedInApiClientOptions = {},
): LinkedInApiClient {
  const fetchFn = options.fetchFn ?? fetch;
  return {
    async createPost(
      input: LinkedInCreatePostInput,
    ): Promise<LinkedInCreatePostResult> {
      const body = {
        author: input.personUrn,
        commentary: input.text,
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      };

      try {
        const response = await fetchFn(POSTS_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            "LinkedIn-Version": input.apiVersion,
            "X-Restli-Protocol-Version": "2.0.0",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (response.status === 201) {
          const id = response.headers.get("x-restli-id") ?? "";
          const postUrn = id.startsWith("urn:li:") ? id : `urn:li:share:${id}`;
          return { ok: true, postUrn };
        }

        const rawBody = await response.text();
        const errorCode = extractErrorCode(rawBody);
        const result: LinkedInCreatePostResult = {
          ok: false,
          status: response.status,
          body: rawBody,
        };
        if (errorCode !== undefined) {
          return { ...result, errorCode };
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, status: 0, body: message };
      }
    },

    async createComment(
      input: LinkedInCreateCommentInput,
    ): Promise<LinkedInCreateCommentResult> {
      const body = {
        actor: input.personUrn,
        object: input.postUrn,
        message: { text: input.text },
      };

      const url = `${SOCIAL_ACTIONS_BASE}/${encodeURIComponent(input.postUrn)}/comments`;

      try {
        const response = await fetchFn(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            "LinkedIn-Version": input.apiVersion,
            "X-Restli-Protocol-Version": "2.0.0",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (response.status === 201) return { ok: true };

        const rawBody = await response.text();
        return { ok: false, status: response.status, body: rawBody };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, status: 0, body: message };
      }
    },
  };
}
