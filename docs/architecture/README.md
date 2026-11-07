# Architecture Documentation

Start with the [project overview](../project-overview.md) for implemented product capabilities and the [system architecture](system-architecture.md) for component boundaries and data flows.

| Guide                                                 | Purpose                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [System architecture](system-architecture.md)         | Browser, REST, realtime, PostgreSQL, optional providers and deployment boundaries.                      |
| [Frontend architecture](frontend-architecture.md)     | Feature placement, routing, server/local state, session isolation and UI conventions.                   |
| [Backend architecture](backend-architecture.md)       | Implemented business modules, authorization, services, persistence and realtime publication.            |
| [Backend developer guide](backend-developer-guide.md) | DTO validation, response allowlists, error handling and development conventions.                        |
| [Database design](database-design.md)                 | Core relationships and schema extensions; migrations/entities remain authoritative for the full schema. |

[Production deployment](../deployment/production.md) and [CI/CD](../deployment/cicd.md) document operational procedures. [Task records](../tasks/README.md) preserve feature contracts and historical verification; the [foundation gap analysis](backend-foundation-gap-analysis.md) and [original roadmap](../roadmap/post-mvp.md) retain their original planning context rather than describing current feature availability.
