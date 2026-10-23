-- ============================================================
-- Seed 009 – Course Topics (syllabus-level detail)
-- ============================================================
-- Concentrated on technical/Computer Science (and closely related
-- Mathematics) courses first, since those are the ones most likely to
-- need topic-level comparison across institutions (e.g. "does NU's Data
-- Structures course cover the same material as BU CS 112?"). Reference
-- links reuse each course's own already-seeded `Source` catalog URL
-- (seed/002 and seed/003) rather than introducing new URLs.
USE CreditEvalManager;
GO

IF OBJECT_ID('tempdb..#Topics') IS NOT NULL DROP TABLE #Topics;

CREATE TABLE #Topics (
    InstitutionCode VARCHAR(20),
    Code            NVARCHAR(30),
    Title           NVARCHAR(200),
    Description     NVARCHAR(MAX),
    SortOrder       INT
);

INSERT INTO #Topics (InstitutionCode, Code, Title, Description, SortOrder) VALUES
-- BU CAS CS 111 — Introduction to Computer Science 1
('BU','CAS CS 111','Variables, control flow & functions','Basic Python/Java syntax: variables, conditionals, loops, function definitions.',1),
('BU','CAS CS 111','Recursion','Recursive problem solving and base-case/recursive-case design.',2),
('BU','CAS CS 111','Basic data structures','Lists, strings, and simple object-oriented concepts.',3),
-- BU CAS CS 112 — Introduction to Computer Science 2
('BU','CAS CS 112','Object-oriented design','Classes, inheritance, interfaces, encapsulation.',1),
('BU','CAS CS 112','Core data structures','Stacks, queues, linked lists, trees, hash tables.',2),
('BU','CAS CS 112','Sorting & searching','Comparison-based sorting algorithms and basic search techniques.',3),
-- BU CAS CS 131 — Combinatoric Structures
('BU','CAS CS 131','Logic & proof techniques','Propositional/predicate logic, direct proof, induction.',1),
('BU','CAS CS 131','Combinatorics','Counting principles, permutations, combinations.',2),
('BU','CAS CS 131','Graph theory basics','Graphs, trees, basic graph algorithms.',3),
-- BU CAS CS 210 — Computer Systems
('BU','CAS CS 210','Machine representation','Binary/number representation, assembly basics.',1),
('BU','CAS CS 210','Memory & the stack','Memory layout, the call stack, pointers.',2),
('BU','CAS CS 210','C programming & systems calls','Low-level C programming and OS-level system calls.',3),
-- BU CAS CS 330 — Introduction to the Analysis of Algorithms
('BU','CAS CS 330','Asymptotic analysis','Big-O/Big-Theta/Big-Omega, recurrence relations.',1),
('BU','CAS CS 330','Divide and conquer & dynamic programming','Algorithm design paradigms with worked examples.',2),
('BU','CAS CS 330','Graph algorithms','Shortest paths, minimum spanning trees, network flow basics.',3),
-- BU CAS MA 293 — Discrete Mathematics (technical, supports CS)
('BU','CAS MA 293','Set theory & logic','Sets, relations, functions, formal logic.',1),
('BU','CAS MA 293','Combinatorics & induction','Counting arguments and proof by induction.',2),
-- Northeastern CS 2000 — Introduction to Program Design and Implementation
('NU','CS 2000','Program design fundamentals','Variables, control flow, functions, basic testing.',1),
('NU','CS 2000','Data abstraction','Introductory data structures and abstraction barriers.',2),
-- Northeastern CS 1800 — Discrete Structures
('NU','CS 1800','Logic & proofs','Propositional/predicate logic, induction.',1),
('NU','CS 1800','Combinatorics & graphs','Counting, combinatorics, intro graph theory.',2),
-- Northeastern CS 3650 — Computer Systems
('NU','CS 3650','C & memory model','C programming, memory layout, pointers.',1),
('NU','CS 3650','OS fundamentals','Processes, system calls, concurrency basics.',2),
-- Northeastern CS 3000 — Algorithms and Data
('NU','CS 3000','Algorithm analysis','Asymptotic complexity and recurrence relations.',1),
('NU','CS 3000','Core algorithm techniques','Divide and conquer, dynamic programming, greedy algorithms.',2),
-- NYU CSCI-UA 101 — Intro to Computer Science
('NYU','CSCI-UA 101','Programming fundamentals','Variables, control flow, functions.',1),
('NYU','CSCI-UA 101','Intro data structures','Lists, basic recursion, simple OOP.',2),
-- NYU CSCI-UA 102 — Data Structures
('NYU','CSCI-UA 102','Core data structures','Stacks, queues, trees, hash tables, linked lists.',1),
('NYU','CSCI-UA 102','Sorting & complexity','Sorting algorithms and asymptotic analysis.',2),
-- NYU CSCI-UA 201 — Computer Systems Organization
('NYU','CSCI-UA 201','Machine & assembly basics','Binary representation, assembly-level programming.',1),
('NYU','CSCI-UA 201','Memory & the stack','Memory layout, pointers, the call stack.',2),
-- NYU CSCI-UA 310 — Basic Algorithms
('NYU','CSCI-UA 310','Algorithm design paradigms','Divide and conquer, dynamic programming, greedy algorithms.',1),
('NYU','CSCI-UA 310','Graph algorithms','Shortest paths and minimum spanning trees.',2),
-- Lighter coverage outside technical courses (one topic each, per "concentrate more on technical")
('BU','CAS EC 101','Supply & demand fundamentals','Core microeconomic models of markets.',1),
('BU','CAS PS 101','Research methods overview','Intro to psychological research methodology.',1),
('BU','CAS BI 107','Cell & molecular basics','Foundational cell biology concepts.',1);

INSERT INTO CourseTopics (CourseId, Title, Description, SortOrder, ReferenceLinksJson)
SELECT
    c.Id,
    t.Title,
    t.Description,
    t.SortOrder,
    CASE WHEN c.Source IS NOT NULL
         THEN '[{"label":"Course catalog entry","url":"' + STRING_ESCAPE(c.Source, 'json') + '"}]'
         ELSE NULL
    END
FROM #Topics t
JOIN Institutions i ON i.Code = t.InstitutionCode
JOIN Courses c ON c.InstitutionId = i.Id AND c.Code = t.Code
WHERE NOT EXISTS (
    SELECT 1 FROM CourseTopics ct WHERE ct.CourseId = c.Id AND ct.Title = t.Title
);
GO

DROP TABLE #Topics;
GO

PRINT 'Course topics seeded (concentrated on CS/technical courses).';
GO
