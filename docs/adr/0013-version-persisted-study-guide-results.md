# Version persisted study guide results

Every persisted Study Guide carries an explicit result schema version such as `study-guide.v1`. API decoders support declared historical versions, while breaking shape changes introduce a new version instead of silently interpreting old JSON as the latest type or requiring an immediate mass rewrite. Result Schema Version describes data shape and remains separate from Pipeline Version and Model Assignment, which may change independently.
