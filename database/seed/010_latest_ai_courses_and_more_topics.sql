-- ============================================================
-- Seed 010 – Latest AI/ML courses + topic coverage for all remaining
-- program areas (Economics, Psychology, Biology, Mathematics)
-- ============================================================
-- Researched against official catalogs (BU CAS bulletin, Northeastern
-- Khoury "All Courses" listing, NYU bulletins.nyu.edu) as of the current
-- session. New courses below are real, currently-offered catalog entries;
-- where a credit value could not be verified on a primary bulletin page,
-- it defaults to that institution's own stated norm (BU: "all required
-- courses are 4 unit hours unless otherwise noted"; NU/NYU: 4, matching
-- their other non-lab courses already seeded).
--
-- Credit-hour note (checked, not changed): the uniform "4" on BU courses
-- in seed/002 is correct per BU's own stated institutional default, not a
-- bug — Northeastern/NYU courses already vary (4 vs 5 for lab-attached
-- courses) in seed/003.
USE CreditEvalManager;
GO

-- ─── New current/trending AI & ML courses ───────────────────
DECLARE @BUID  INT = (SELECT Id FROM Institutions WHERE Code = 'BU');
DECLARE @NUID  INT = (SELECT Id FROM Institutions WHERE Code = 'NU');
DECLARE @NYUID INT = (SELECT Id FROM Institutions WHERE Code = 'NYU');

INSERT INTO Courses (InstitutionId, Code, Title, ProgramArea, RequirementType, Credits, Verified, Notes, Source)
SELECT v.InstitutionId, v.Code, v.Title, v.ProgramArea, v.RequirementType, v.Credits, v.Verified, v.Notes, v.Source
FROM (VALUES
  (@BUID, 'CAS CS 440', 'Artificial Intelligence',                          'Computer Science', 'Elective', 4, 'Check', 'Credits per BU 4-unit-hour default; verify in current Bulletin', 'https://www.cs.bu.edu/faculty/betke/cs440'),
  (@NUID, 'CS 1700',    'AI for Everyone',                                  'Computer Science', 'Elective', 4, 'Check', 'Credits inferred (no lab); verify in Khoury catalog',           'https://www.khoury.northeastern.edu/all-courses/'),
  (@NUID, 'CY 4100',    'AI Security and Privacy',                          'Computer Science', 'Elective', 4, 'Check', 'Credits inferred (no lab); verify in Khoury catalog',           'https://www.khoury.northeastern.edu/all-courses/'),
  (@NYUID,'CSCI-UA 472','Artificial Intelligence',                          'Computer Science', 'Elective', 4, 'Check', 'Credits match other CSCI-UA courses; verify on primary bulletin','https://bulletins.nyu.edu/undergraduate/arts-science/courses/csci-ua/'),
  (@NYUID,'CSCI-UA 473','Fundamentals of Machine Learning',                 'Computer Science', 'Elective', 4, 'Check', 'Credits match other CSCI-UA courses; verify on primary bulletin','https://bulletins.nyu.edu/undergraduate/arts-science/courses/csci-ua/')
) AS v(InstitutionId, Code, Title, ProgramArea, RequirementType, Credits, Verified, Notes, Source)
WHERE NOT EXISTS (
    SELECT 1 FROM Courses c WHERE c.InstitutionId = v.InstitutionId AND c.Code = v.Code
);
GO

-- ─── Topics ──────────────────────────────────────────────────
IF OBJECT_ID('tempdb..#Topics') IS NOT NULL DROP TABLE #Topics;

CREATE TABLE #Topics (
    InstitutionCode VARCHAR(20),
    Code            NVARCHAR(30),
    Title           NVARCHAR(200),
    Description     NVARCHAR(MAX),
    SortOrder       INT
);

INSERT INTO #Topics (InstitutionCode, Code, Title, Description, SortOrder) VALUES
-- New AI/ML courses
('BU','CAS CS 440','Search & problem solving','Uninformed and heuristic search algorithms for AI problem solving.',1),
('BU','CAS CS 440','Knowledge representation & reasoning','Logic-based representation and automated reasoning.',2),
('BU','CAS CS 440','Machine learning basics','Introductory supervised learning concepts applied to AI systems.',3),
('NU','CS 1700','Overview of AI applications','Survey of current real-world AI applications and capabilities.',1),
('NU','CS 1700','Ethics & limitations of AI','Societal impact, bias, and limitations of AI systems.',2),
('NU','CY 4100','AI security threats','Adversarial attacks and security risks specific to AI/ML systems.',1),
('NU','CY 4100','Privacy-preserving ML techniques','Differential privacy and related techniques for ML systems.',2),
('NYU','CSCI-UA 472','Representation & reasoning','Knowledge representation and automated reasoning techniques.',1),
('NYU','CSCI-UA 472','Machine learning','Core ML techniques as applied within AI systems.',2),
('NYU','CSCI-UA 472','Natural language processing','Fundamentals of NLP as a core AI application area.',3),
('NYU','CSCI-UA 473','Supervised learning','Linear/logistic regression, SVMs, decision trees, ensemble methods.',1),
('NYU','CSCI-UA 473','Clustering & dimensionality reduction','Unsupervised learning techniques.',2),
('NYU','CSCI-UA 473','Statistical inference for ML','Inference techniques underlying machine learning methods.',3),

-- BU Economics
('BU','CAS EC 101','Consumer & firm theory','Utility maximization and firm production decisions.',2),
('BU','CAS EC 101','Market structures','Perfect competition, monopoly, and oligopoly basics.',3),
('BU','CAS EC 102','National income accounting','GDP, inflation, and unemployment measurement.',1),
('BU','CAS EC 102','Aggregate supply & demand','Monetary and fiscal policy in the AS/AD model.',2),
('BU','CAS EC 201','Consumer theory & utility maximization','Formal consumer choice theory.',1),
('BU','CAS EC 201','Producer theory & cost curves','Firm cost structures and production theory.',2),
('BU','CAS EC 202','IS-LM model','Short-run macroeconomic equilibrium model.',1),
('BU','CAS EC 202','Growth theory & business cycles','Long-run growth models and business cycle analysis.',2),
('BU','CAS EC 203','Statistical techniques for economic data','Using statistical software (e.g. STATA) on economic datasets.',1),
('BU','CAS EC 203','Hypothesis testing & intro regression','Applied hypothesis testing and simple regression.',2),
('BU','CAS EC 204','Regression analysis continued','Multiple regression and model specification.',1),
('BU','CAS EC 204','Time-series basics & applied project','Intro time-series methods with an applied empirical project.',2),

-- BU Psychology
('BU','CAS PS 101','Major subfields of psychology','Survey of cognitive, social, developmental, and clinical psychology.',2),
('BU','CAS PS 101','Biological bases of behavior','Neuroscience foundations of behavior.',3),
('BU','CAS PS 211','Experimental design principles','Core principles of psychological experiment design.',1),
('BU','CAS PS 211','Descriptive & inferential statistics','Statistical methods for psychological research.',2),
('BU','CAS PS 231','Neuroanatomy basics','Core brain structures and their functions.',1),
('BU','CAS PS 231','Physiological bases of cognition','Physiological mechanisms underlying sensation and cognition.',2),
('BU','CAS PS 222','Sensory processes','How sensory systems encode information.',1),
('BU','CAS PS 222','Perceptual organization','Principles of perceptual grouping and organization.',2),
('BU','CAS PS 336','Attention & memory models','Cognitive models of attention and memory.',1),
('BU','CAS PS 336','Language & problem solving','Cognitive processes in language and problem solving.',2),
('BU','CAS PS 241','Cognitive development','Stages and theories of cognitive development.',1),
('BU','CAS PS 241','Social & emotional development','Development of social and emotional functioning.',2),
('BU','CAS PS 251','Personality theories','Trait, psychodynamic, and humanistic theories of personality.',1),
('BU','CAS PS 251','Personality assessment','Methods for assessing personality.',2),
('BU','CAS PS 261','Social cognition & attitudes','How people perceive and reason about others.',1),
('BU','CAS PS 261','Group dynamics & conformity','Group behavior, conformity, and intergroup relations.',2),
('BU','CAS PS 371','Classification of psychological disorders','DSM-based classification of psychological disorders.',1),
('BU','CAS PS 371','Etiology & treatment approaches','Causes and treatment approaches for psychopathology.',2),

-- BU Biology / Chemistry
('BU','CAS BI 107','Genetics & evolution basics','Foundational genetics and evolutionary theory.',2),
('BU','CAS BI 108','Organismal diversity','Survey of major groups of organisms.',1),
('BU','CAS BI 108','Physiology basics','Introductory animal and plant physiology.',2),
('BU','CAS BI 203','Membrane transport & signaling','Cell membrane structure, transport, and signaling.',1),
('BU','CAS BI 203','Cell cycle & division','Mitosis, meiosis, and cell cycle regulation.',2),
('BU','CAS BI 206','Mendelian genetics','Classical inheritance patterns.',1),
('BU','CAS BI 206','Molecular genetics','DNA/RNA structure and gene expression.',2),
('BU','CAS CH 101','Atomic structure & bonding','Atomic theory and chemical bonding models.',1),
('BU','CAS CH 101','Stoichiometry & reaction types','Quantitative relationships in chemical reactions.',2),
('BU','CAS CH 102','Thermodynamics & equilibrium','Chemical thermodynamics and equilibrium.',1),
('BU','CAS CH 102','Acid-base & redox reactions','Acid-base chemistry and oxidation-reduction reactions.',2),
('BU','CAS CH 203','Functional groups','Organic functional groups and nomenclature.',1),
('BU','CAS CH 203','Reaction mechanisms 1','Core organic reaction mechanisms.',2),
('BU','CAS CH 204','Reaction mechanisms 2','Advanced organic reaction mechanisms.',1),
('BU','CAS CH 204','Spectroscopy basics','Structure determination via spectroscopy.',2),

-- BU Mathematics
('BU','CAS MA 123','Limits & continuity','Foundational limit and continuity concepts.',1),
('BU','CAS MA 123','Derivatives & differentiation rules','Core differentiation techniques.',2),
('BU','CAS MA 124','Integration techniques','Techniques of integration.',1),
('BU','CAS MA 124','Applications of integration','Area, volume, and other applications.',2),
('BU','CAS MA 225','Partial derivatives','Differentiation of multivariable functions.',1),
('BU','CAS MA 225','Multiple integrals & vector calculus','Double/triple integrals and vector calculus basics.',2),
('BU','CAS MA 242','Systems of linear equations','Solving and interpreting linear systems.',1),
('BU','CAS MA 242','Eigenvalues & eigenvectors','Eigenvalue theory and applications.',2),
('BU','CAS MA 226','First-order ODEs','Solution methods for first-order differential equations.',1),
('BU','CAS MA 226','Linear ODEs & systems','Linear differential equations and systems of ODEs.',2),
('BU','CAS MA 581','Probability axioms & distributions','Foundational probability theory and common distributions.',1),
('BU','CAS MA 581','Random variables & limit theorems','Random variables, expectation, and limit theorems.',2),

-- Northeastern Economics/Psychology/Biology/Mathematics
('NU','ECON 1116','Market equilibrium','Supply and demand equilibrium analysis.',1),
('NU','ECON 1116','Consumer & producer theory','Consumer choice and producer decisions.',2),
('NU','ECON 1115','National income & aggregate demand','Macroeconomic accounting and aggregate demand.',1),
('NU','ECON 1115','Monetary & fiscal policy','Policy tools and their macroeconomic effects.',2),
('NU','ECON 2316','Consumer theory','Formal consumer choice theory.',1),
('NU','ECON 2316','Producer theory & market structure','Firm behavior across market structures.',2),
('NU','ECON 2315','Growth models','Long-run economic growth theory.',1),
('NU','ECON 2315','Business cycle theory','Short-run fluctuations and business cycle models.',2),
('NU','ECON 2350','Probability & sampling distributions','Probability theory for economic statistics.',1),
('NU','ECON 2350','Hypothesis testing for economic data','Applied hypothesis testing methods.',2),
('NU','ECON 2560','Regression modeling','Multiple regression techniques.',1),
('NU','ECON 2560','Causal inference methods','Methods for causal inference in economics.',2),
('NU','PSYC 1101','Overview of psychology subfields','Survey of major psychology subfields.',1),
('NU','PSYC 1101','Research methods overview','Core research methodology in psychology.',2),
('NU','PSYC 2320','Descriptive & inferential statistics','Statistical methods for psychological research.',1),
('NU','PSYC 2320','Research design in psychology','Designing valid psychological studies.',2),
('NU','PSYC 3458','Neuroanatomy','Core brain structures relevant to behavior.',1),
('NU','PSYC 3458','Neurotransmission & behavior','How neurotransmission relates to behavior.',2),
('NU','PSYC 3402','Social cognition','Cognitive processes in social perception.',1),
('NU','PSYC 3402','Group behavior','Dynamics of group behavior and influence.',2),
('NU','PSYC 3404','Cognitive development','Theories of cognitive development across the lifespan.',1),
('NU','PSYC 3404','Social development across lifespan','Social and emotional development across the lifespan.',2),
('NU','PSYC 3464','Language acquisition','How language is acquired and develops.',1),
('NU','PSYC 3464','Psycholinguistics','Cognitive processes underlying language use.',2),
('NU','BIOL 1107','Cell biology basics','Foundational cell biology concepts.',1),
('NU','BIOL 1107','Genetics & evolution','Core genetics and evolutionary theory.',2),
('NU','BIOL 1113','Organismal diversity','Survey of major organism groups.',1),
('NU','BIOL 1113','Physiology continuation','Continued study of animal/plant physiology.',2),
('NU','BIOL 2299','Scientific inquiry methods','Methods of biological scientific inquiry.',1),
('NU','BIOL 2299','Experimental design in biology','Designing valid biological experiments.',2),
('NU','BIOL 2301','Molecular genetics','DNA/RNA structure and function.',1),
('NU','BIOL 2301','Gene expression & regulation','How gene expression is regulated.',2),
('NU','BIOL 3611','Protein structure & function','Structure-function relationships in proteins.',1),
('NU','BIOL 3611','Metabolic pathways','Core cellular metabolic pathways.',2),
('NU','CHEM 1161','Atomic structure & bonding','Atomic theory and chemical bonding.',1),
('NU','CHEM 1161','Stoichiometry','Quantitative relationships in reactions.',2),
('NU','CHEM 2311','Organic reaction mechanisms 1','Core organic reaction mechanisms.',1),
('NU','CHEM 2311','Functional groups','Organic functional group chemistry.',2),
('NU','CHEM 2313','Organic reaction mechanisms 2','Advanced organic reaction mechanisms.',1),
('NU','CHEM 2313','Spectroscopy','Structure determination via spectroscopy.',2),
('NU','MATH 1341','Limits & derivatives','Foundational limits and differentiation.',1),
('NU','MATH 1341','Applications of the derivative','Applied differentiation problems.',2),
('NU','MATH 1342','Integration techniques','Techniques of integration.',1),
('NU','MATH 1342','Series & sequences','Infinite series and sequences.',2),
('NU','MATH 2321','Multivariable calculus','Differentiation and integration of multivariable functions.',1),
('NU','MATH 2321','Vector calculus','Vector fields, line and surface integrals.',2),
('NU','MATH 2331','Linear systems','Solving and interpreting linear systems.',1),
('NU','MATH 2331','Eigenvalues & eigenvectors','Eigenvalue theory and applications.',2),
('NU','MATH 2341','Differential equations basics','Core solution methods for ODEs.',1),
('NU','MATH 2341','Linear algebra for engineering','Applied linear algebra techniques.',2),
('NU','MATH 1365','Mathematical proof techniques','Direct proof, induction, contradiction.',1),
('NU','MATH 1365','Set theory & logic','Foundational set theory and logic.',2),
('NU','MATH 3081','Probability distributions','Common probability distributions.',1),
('NU','MATH 3081','Statistical inference','Core statistical inference techniques.',2),

-- NYU Economics/Psychology/Biology/Mathematics
('NYU','ECON-UA 2','Supply & demand','Market equilibrium analysis.',1),
('NYU','ECON-UA 2','Market structures','Competition, monopoly, and oligopoly.',2),
('NYU','ECON-UA 1','National accounts','GDP and macroeconomic accounting.',1),
('NYU','ECON-UA 1','Monetary & fiscal policy','Macroeconomic policy tools.',2),
('NYU','ECON-UA 10','Consumer & producer theory','Formal micro theory of consumers and producers.',1),
('NYU','ECON-UA 10','Market structure & welfare','Welfare analysis across market structures.',2),
('NYU','ECON-UA 12','IS-LM & growth models','Short-run and long-run macro models.',1),
('NYU','ECON-UA 12','Business cycles','Business cycle theory and evidence.',2),
('NYU','ECON-UA 18','Probability & sampling','Probability theory for applied statistics.',1),
('NYU','ECON-UA 18','Hypothesis testing','Applied hypothesis testing methods.',2),
('NYU','ECON-UA 266','Regression & causal inference','Multiple regression and causal inference methods.',1),
('NYU','ECON-UA 266','Applied econometrics project','Hands-on applied econometrics project.',2),
('NYU','PSYCH-UA 1','Subfields overview','Survey of major psychology subfields.',1),
('NYU','PSYCH-UA 1','Research methods','Core research methodology in psychology.',2),
('NYU','PSYCH-UA 10','Descriptive statistics','Core descriptive statistical methods.',1),
('NYU','PSYCH-UA 10','Inferential statistics','Core inferential statistical methods.',2),
('NYU','PSYCH-UA 11','Data analysis for psych research','Applied data analysis techniques.',1),
('NYU','PSYCH-UA 11','Research design','Designing valid psychological studies.',2),
('NYU','PSYCH-UA 22','Sensory processes','How sensory systems encode information.',1),
('NYU','PSYCH-UA 22','Perceptual organization','Principles of perceptual grouping.',2),
('NYU','PSYCH-UA 25','Neural basis of cognition','Neural mechanisms underlying cognition.',1),
('NYU','PSYCH-UA 25','Brain imaging methods','Core neuroimaging techniques.',2),
('NYU','PSYCH-UA 29','Attention & memory','Cognitive models of attention and memory.',1),
('NYU','PSYCH-UA 29','Language & cognition','Cognitive processes in language use.',2),
('NYU','PSYCH-UA 30','Personality theory','Major theories of personality.',1),
('NYU','PSYCH-UA 30','Personality assessment','Methods for assessing personality.',2),
('NYU','PSYCH-UA 32','Social cognition','How people perceive and reason about others.',1),
('NYU','PSYCH-UA 32','Group dynamics','Group behavior and intergroup relations.',2),
('NYU','PSYCH-UA 34','Lifespan development','Development across the lifespan.',1),
('NYU','PSYCH-UA 34','Developmental research methods','Methods for studying development.',2),
('NYU','PSYCH-UA 51','Psychopathology classification','DSM-based classification of disorders.',1),
('NYU','PSYCH-UA 51','Treatment approaches','Treatment approaches for psychopathology.',2),
('NYU','BIOL-UA 11','Cell biology','Foundational cell biology concepts.',1),
('NYU','BIOL-UA 11','Genetics basics','Foundational genetics concepts.',2),
('NYU','BIOL-UA 12','Evolution','Evolutionary theory and mechanisms.',1),
('NYU','BIOL-UA 12','Organismal diversity','Survey of major organism groups.',2),
('NYU','BIOL-UA 21','Molecular & cell biology mechanisms','Core molecular/cell biology mechanisms.',1),
('NYU','BIOL-UA 21','Membrane transport & signaling','Cell membrane transport and signaling.',2),
('NYU','BIOL-UA 30','Mendelian genetics','Classical inheritance patterns.',1),
('NYU','BIOL-UA 30','Molecular genetics','DNA/RNA structure and gene expression.',2),
('NYU','CHEM-UA 125','Atomic structure & bonding','Atomic theory and chemical bonding.',1),
('NYU','CHEM-UA 125','Stoichiometry','Quantitative relationships in reactions.',2),
('NYU','CHEM-UA 126','Thermodynamics & equilibrium','Chemical thermodynamics and equilibrium.',1),
('NYU','CHEM-UA 126','Acid-base & redox reactions','Acid-base and oxidation-reduction chemistry.',2),
('NYU','CHEM-UA 225','Functional groups','Organic functional groups and nomenclature.',1),
('NYU','CHEM-UA 225','Reaction mechanisms 1','Core organic reaction mechanisms.',2),
('NYU','CHEM-UA 226','Reaction mechanisms 2','Advanced organic reaction mechanisms.',1),
('NYU','CHEM-UA 226','Spectroscopy basics','Structure determination via spectroscopy.',2),
('NYU','MATH-UA 121','Limits & continuity','Foundational limit and continuity concepts.',1),
('NYU','MATH-UA 121','Derivatives','Core differentiation techniques.',2),
('NYU','MATH-UA 122','Integration techniques','Techniques of integration.',1),
('NYU','MATH-UA 122','Applications of integration','Area, volume, and other applications.',2),
('NYU','MATH-UA 123','Multivariable calculus','Differentiation of multivariable functions.',1),
('NYU','MATH-UA 123','Vector calculus','Vector fields, line and surface integrals.',2),
('NYU','MATH-UA 140','Linear systems','Solving and interpreting linear systems.',1),
('NYU','MATH-UA 140','Eigenvalues & eigenvectors','Eigenvalue theory and applications.',2),
('NYU','MATH-UA 262','First-order ODEs','Solution methods for first-order differential equations.',1),
('NYU','MATH-UA 262','Systems of ODEs','Systems of ordinary differential equations.',2),
('NYU','MATH-UA 233','Probability theory','Foundational probability theory.',1),
('NYU','MATH-UA 233','Random variables','Random variables and their distributions.',2),
('NYU','MATH-UA 235','Probability & statistics','Applied probability and statistics.',1),
('NYU','MATH-UA 235','Statistical inference','Core statistical inference techniques.',2);

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

PRINT 'Latest AI/ML courses added; topic coverage extended to Economics/Psychology/Biology/Mathematics.';
GO
