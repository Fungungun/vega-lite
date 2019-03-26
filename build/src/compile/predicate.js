import { isString } from 'vega-util';
import { fieldFilterExpression, isSelectionPredicate } from '../predicate';
import { logicalExpr } from '../util';
import { assembleSelectionPredicate } from './selection/assemble';
/**
 * Converts a predicate into an expression.
 */
// model is only used for selection filters.
export function expression(model, filterOp, node) {
    return logicalExpr(filterOp, (predicate) => {
        if (isString(predicate)) {
            return predicate;
        }
        else if (isSelectionPredicate(predicate)) {
            return assembleSelectionPredicate(model, predicate.selection, node);
        }
        else {
            // Filter Object
            return fieldFilterExpression(predicate);
        }
    });
}
//# sourceMappingURL=predicate.js.map