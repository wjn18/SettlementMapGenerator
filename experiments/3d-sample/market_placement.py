"""Shared conservative horizontal occupancy for independently built markets."""
import math


class MarketOccupancy:
    def __init__(self, records=None, market_id=None):
        if records is not None and market_id is None:
            raise ValueError('Shared market occupancy requires a source market ID.')
        self.records = records
        self.market_id = str(market_id) if market_id is not None else None
        if self.market_id == '':
            raise ValueError('A source market ID must not be empty.')
        for record in records or []:
            self._footprint(record['center'], record['radius'])
            if record.get('marketId') == self.market_id and record.get('object'):
                raise ValueError('This source market has already been assembled: '+self.market_id)

    @staticmethod
    def _footprint(point, radius):
        if len(point) != 2 or any(not math.isfinite(float(v)) for v in point):
            raise ValueError('Market occupancy requires a finite XY position.')
        if not math.isfinite(float(radius)) or radius < 0:
            raise ValueError('Market occupancy requires a finite nonnegative radius.')

    def clear(self, point, radius):
        self._footprint(point, radius)
        return all(record.get('marketId') == self.market_id or
                   math.dist(point, record['center']) > radius+record['radius']
                   for record in self.records or [])

    def reserve(self, point, radius, kind, object_name):
        self._footprint(point, radius)
        if self.records is not None:
            self.records.append({'center': list(point), 'radius': float(radius),
                                 'marketId': self.market_id, 'kind': kind,
                                 'object': object_name})
