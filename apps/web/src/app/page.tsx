import { ActionLink, PageContainer } from "../components/ui-primitives";

const journeySteps = [
  {
    number: "01",
    title: "Bring the home together",
    description:
      "Add plans, photographs, video, room captures and the measurements you already trust.",
  },
  {
    number: "02",
    title: "Understand what is known",
    description:
      "Review a source-aware home model where observations, proposals, conflicts and unknowns stay distinct.",
  },
  {
    number: "03",
    title: "Develop design directions",
    description:
      "Shape an editable brief, compare coherent options and inspect the assumptions behind each choice.",
  },
  {
    number: "04",
    title: "Prepare to implement",
    description:
      "Carry the selected direction into room schedules, materials, decisions and a versioned handoff.",
  },
] as const;

const principles = [
  {
    term: "Evidence stays attached",
    detail:
      "Every important home attribute can point back to a source or remain explicitly unknown.",
  },
  {
    term: "Proposals stay editable",
    detail:
      "Reconstruction and design suggestions are reviewed before they become the current model.",
  },
  {
    term: "Visuals stay honest",
    detail: "Images and walkthroughs help you decide without being presented as dimensional truth.",
  },
] as const;

export default function HomePage() {
  return (
    <>
      <section className="hero" aria-labelledby="home-title">
        <PageContainer className="hero__layout">
          <div className="hero__copy">
            <h1 id="home-title">Design your whole home with the evidence in view.</h1>
            <p className="hero__lede">
              Bring what you know into one source-aware workspace. Understand the home, explore
              editable directions and leave with a clearer implementation handoff.
            </p>
            <div className="hero__actions">
              <ActionLink href="/sign-in">Start with a local fixture</ActionLink>
              <ActionLink href="#principles" tone="quiet">
                Read our principles
              </ActionLink>
            </div>
          </div>

          <aside className="journey-map" aria-label="From evidence to implementation">
            <p className="journey-map__title">One connected design journey</p>
            <ol>
              <li>
                <span>Home evidence</span>
                <small>Plans, capture, photographs and measurements</small>
              </li>
              <li>
                <span>Source-aware model</span>
                <small>Observed, inferred and unknown kept distinct</small>
              </li>
              <li>
                <span>Design decisions</span>
                <small>Editable options, comparisons and handoff</small>
              </li>
            </ol>
          </aside>
        </PageContainer>
      </section>

      <section className="journey" id="journey" aria-labelledby="journey-title">
        <PageContainer>
          <div className="section-heading">
            <h2 id="journey-title">From the home you have to the home you choose.</h2>
            <p>
              The workspace follows a clear sequence while preserving the evidence and decisions
              that make each step understandable.
            </p>
          </div>
          <ol className="journey__steps">
            {journeySteps.map((step) => (
              <li key={step.number}>
                <span aria-hidden="true" className="journey__number">
                  {step.number}
                </span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </PageContainer>
      </section>

      <section className="principles" id="principles" aria-labelledby="principles-title">
        <PageContainer className="principles__layout">
          <div className="section-heading section-heading--compact">
            <h2 id="principles-title">Clarity is part of the design.</h2>
            <p>
              A convincing result should never hide where it came from or what still needs review.
            </p>
          </div>
          <dl className="principles__list">
            {principles.map((principle) => (
              <div key={principle.term}>
                <dt>{principle.term}</dt>
                <dd>{principle.detail}</dd>
              </div>
            ))}
          </dl>
        </PageContainer>
      </section>

      <section className="closing" aria-labelledby="closing-title">
        <PageContainer className="closing__inner">
          <div>
            <h2 id="closing-title">Start with what you know.</h2>
            <p>The system is designed to keep gaps visible and make the next useful step clear.</p>
          </div>
          <ActionLink href="#journey" tone="secondary">
            Review the journey
          </ActionLink>
        </PageContainer>
      </section>
    </>
  );
}
