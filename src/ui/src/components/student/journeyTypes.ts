export interface JourneyCourse {
  id: string; code: string; title: string; term: string | null; grade: string | null; institutionName: string;
  originalCredits: number; convertedCredits: number; calendar: string; bucket: string | null;
}
export interface JourneyOverview {
  institution: { id: number | null; name: string; source: 'transcript' | 'profile' | 'education' } | null;
  program: string | null;
  educationLevel: string | null;
  courses: JourneyCourse[];
  totals: { courses: number; originalCredits: number; convertedCredits: number };
  profileCredits: number | null;
  target: { institutionId: number; institutionName: string; institutionCode: string; programId: number | null; programName: string | null } | null;
  atTarget: {
    secure: number; likelyLow: number; likelyHigh: number; pending: number; notCounted: number;
    cap: number; capRemaining: number; isProvisional: boolean;
  } | null;
}

export interface JourneyUniversity { id: number; code: string; name: string; logoUrl: string | null }

export interface MatchedCourse {
  studentCourseId: string; studentCode: string; studentTitle: string; convertedCredits: number;
  kind: 'known' | 'suggested'; universityCourseId: number; universityCode: string; universityTitle: string; universityCredits: number;
  transferCredits: number; outcome: 'equivalent' | 'elective' | null; confidence: number | null; reason: string;
}
export interface ProgramRollup {
  programId: number; name: string; area: string | null; degree: string | null; school: string | null;
  matched: MatchedCourse[]; knownCredits: number; suggestedCredits: number; transferableCredits: number; coursesCovered: number; capped: boolean;
}
export interface UniversityComparison {
  institutionId: number; code: string; name: string; cap: number;
  summary: {
    studentCourses: number; coursesMatched: number; coursesKnown: number; coursesSuggested: number; percentMatched: number;
    knownCredits: number; suggestedCredits: number; transferableCredits: number; capped: boolean;
  };
  programs: ProgramRollup[];
  otherMatches: MatchedCourse[];
  noMatch: { studentCourseId: string; studentCode: string; studentTitle: string; convertedCredits: number; reason: string }[];
}
export interface CompareResult { preview: boolean; note: string; studentCourses: { id: string; code: string; title: string; term: string | null; convertedCredits: number }[]; universities: UniversityComparison[] }

export const fmtCredits = (n: number) => (Math.round(n * 100) / 100).toString();
