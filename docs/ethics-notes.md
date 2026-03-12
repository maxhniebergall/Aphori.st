# Ethical Considerations — Draft Notes

## LLM bias and fairness
- LLM extraction may favor certain rhetorical styles over other equally valid argumentation
- The system inheirents the biases and capabilities of the underlying LLMs, particularly with respect to written language
- Deduplication merges could erase meaningful nuance between similar-but-distinct arguments, collapsing minority viewpoints into majority framings
- The LLM acts as an unaccountable judge of what constitutes "an argument" and what counts as "equivalent" — these are value-laden decisions embedded in prompts & training data
- Any set of systematic biases will inheirently have a disperate impact, causing more harm to some than others. 

## Ranking and quality
- Deciding what arguments people see and get to interact with is a fundamentally different ethical problem than identifying what arguments people have already made
- Defining "argument quality" algorithmically is inherently normative — privileging multi-claim, structured argumentation may disadvantage valid emotional, experiential, or narrative contributions
- Sophisticated propaganda that argues well would rank highly — the system rewards argumentative skill, not truthfulness
- Could create a new kind of filter bubble: not engagement-based but argumentation-style-based
- The manipulation resilience claim is untested and could give platform operators a false sense of security

## Human-AI interaction
- AI agents participating alongside humans raises disclosure questions: users should know which replies are machine-generated
- AI agents optimized to produce text that scores well on EvidenceRank could dominate discussions
- Asymmetry: AI agents can generate high-volume, multi-claim arguments effortlessly; humans cannot
- Risk of displacing human deliberation with machine-generated argumentation that appears substantive

## Data and privacy
- CMV evaluation uses public Reddit data from real users who did not consent to argument mining research specifically
- Argument graphs make users' reasoning patterns more visible and trackable than raw text
- Persistent cross-thread deduplication creates a detailed map of who argues what across discussions
- There is a risk of propaganda and control inheirent to deciding what arguments people see

## Commercial and access
- Dependency on commercial LLM APIs (Gemini) means the platform's core function is controlled by a third party
- Cost of LLM calls creates a barrier — argument-quality ranking may only be feasible for well-funded platforms
- Environmental cost of running multiple LLM calls per post at scale

## Positive considerations
- Reducing the effectiveness of bot-driven manipulation in online discourse
- Rewarding substance over volume/engagement
- Making argument structure visible and navigable, supporting deliberative democracy
- Enabling meaningful integration of machine reasoning alongside human reasoning
- Allows anyone to engage in a discourse, potentially protecting from of the inheirent biases
- The potential to act as a learning resource and feedback system
- Potentially an open alternative to private social media sites, with transparent algorithms and collaboration

## Popular platforms today
- Operated by corporations with a fiduciary to maximize profits in the interests of shareholders, while users, the public interest, and the persuit of knowledge are secondary
- Incentivised by advirtising model to optimize for time-on-platform at the expensive of all other goals
- In some cases, knowingly optimize algorithms to make users upset
