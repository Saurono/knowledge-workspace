import type { WikiActor, WikiAuthorKind, WikiProvenance } from "@/modules/wiki/domain"

const actorLabel = (actor: WikiActor) => `${actor.kind} · ${actor.id}`
const originLabel = (kinds: readonly WikiAuthorKind[]) => kinds.length > 1 ? "mixed" : kinds[0] ?? "unknown"

/** Reusable local/shared view. Missing attribution is displayed as unknown for legacy records. */
export function WikiAuthorshipView({ authorship }: { authorship?: Pick<WikiProvenance, "creator" | "revisions" | "reviews"> | null }) {
  if (!authorship?.creator && !authorship?.revisions?.length && !authorship?.reviews?.length)
    return <section aria-label="Wiki authorship"><strong>Source: unknown</strong><p>Legacy or unrecorded authorship</p></section>
  return <section aria-label="Wiki authorship" className="space-y-2">
    <div><strong>Source: {originLabel(authorship.revisions?.[authorship.revisions.length - 1]?.originKinds ?? [])}</strong>
      <p>Created by {authorship.creator ? actorLabel(authorship.creator) : "unknown"}</p></div>
    {authorship.revisions?.length ? <ol aria-label="Contribution history" className="space-y-1">
      {authorship.revisions.map((revision) => <li key={`${revision.revision}-${revision.contentHash}`} className="text-xs text-muted-foreground">
        <span>v{revision.revision} · {originLabel(revision.originKinds)} · {actorLabel(revision.actor)} · {revision.createdAt}</span>
        {revision.actor.taskId ? <span> · task {revision.actor.taskId}</span> : null}
        {revision.actor.reason ? <span> · {revision.actor.reason}</span> : null}
      </li>)}
    </ol> : null}
    {authorship.reviews?.length ? <ol aria-label="Review history" className="space-y-1">
      {authorship.reviews.map((review, index) => <li key={`${review.reviewedRevision}-${index}`} className="text-xs text-muted-foreground">
        Review of v{review.reviewedRevision}: {review.decision} by {actorLabel(review.actor)} · {review.createdAt}
      </li>)}
    </ol> : null}
  </section>
}
