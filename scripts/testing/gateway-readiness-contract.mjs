export function isExpectedGatewayReadinessRejection(response, result) {
  return Boolean(
    response &&
    response.ok === false &&
    response.status === 400 &&
    result &&
    typeof result === 'object' &&
    result.code === 'order_rejected'
  );
}
