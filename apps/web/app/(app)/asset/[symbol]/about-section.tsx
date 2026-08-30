import { Card, SectionHeader } from "@sage/ui";
import { formatDate } from "../../../../lib/format";
import type { AssetProfileDTO } from "../../../../lib/types";

export function AboutSection({ profile }: { profile: AssetProfileDTO }) {
  if (!(profile.description || profile.ceo || profile.fullTimeEmployees || profile.ipoDate)) {
    return null;
  }
  return (
    <section className="mb-10">
      <SectionHeader title="About" />
      <Card>
        {profile.description && (
          <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
            {profile.description.length > 300
              ? `${profile.description.slice(0, 300)}…`
              : profile.description}
          </p>
        )}
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          {profile.ceo && (
            <div>
              <span className="label-caps text-muted-foreground">CEO</span>
              <div className="text-sm font-medium">{profile.ceo}</div>
            </div>
          )}
          {profile.fullTimeEmployees && (
            <div>
              <span className="label-caps text-muted-foreground">Employees</span>
              <div className="text-sm font-medium">
                {Number(profile.fullTimeEmployees).toLocaleString()}
              </div>
            </div>
          )}
          {profile.ipoDate && (
            <div>
              <span className="label-caps text-muted-foreground">IPO date</span>
              <div className="text-sm font-medium">
                {formatDate(profile.ipoDate, { year: "always" })}
              </div>
            </div>
          )}
          {profile.website && (
            <div>
              <span className="label-caps text-muted-foreground">Website</span>
              <div className="text-sm font-medium">
                <a
                  href={profile.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {profile.website.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
              </div>
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}
