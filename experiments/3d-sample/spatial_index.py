"""Deterministic broad-phase lookup for unchanged planning footprints."""
import math


class BoxIndex:
    def __init__(self, entries=(), cell_size=16):
        self.cell_size=cell_size;self.boxes={};self.cells={};self.order={}
        for key,box in entries:self.add(key,box)

    def cells_for(self,box):
        return ((x,y) for x in range(math.floor(box[0]/self.cell_size),math.floor(box[1]/self.cell_size)+1)
                for y in range(math.floor(box[2]/self.cell_size),math.floor(box[3]/self.cell_size)+1))

    def add(self,key,box):
        self.order[key]=len(self.order);self.boxes[key]=box
        for cell in self.cells_for(box):self.cells.setdefault(cell,[]).append(key)

    def query(self,box):
        candidates={key for cell in self.cells_for(box) for key in self.cells.get(cell,())}
        return [key for key in sorted(candidates,key=self.order.get) if self.boxes[key][0]<=box[1] and box[0]<=self.boxes[key][1]
                and self.boxes[key][2]<=box[3] and box[2]<=self.boxes[key][3]]
